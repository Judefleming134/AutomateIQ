import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { dublinDate } from "@/lib/growth/dates";
import { autoDraftReply } from "@/lib/growth/reply-draft";
import { PRE_REPLY_STATUSES } from "@/lib/growth/autopilot";

// The capture itself is instant, but the best-effort reply draft makes one AI
// call — give the invocation room so it finishes in the same request.
export const maxDuration = 45;

/**
 * Inbound reply capture → the Growth Engine inbox.
 *
 * A prospect's email reply lands in Jude's mailbox (the reply-to addresses),
 * but the CRM only knew about replies he pasted in by hand — easy to miss one.
 * This endpoint receives a forwarded reply and logs it against the matching
 * prospect exactly like the manual "Log their reply" action: an inbound
 * message row + status → replied (answer within a day). It then shows in the
 * inbox as "Reply due" and in the morning brief's overnight-replies section.
 *
 * Provider-agnostic: point any inbound-email forwarder at it (Cloudflare
 * Email Routing worker, SendGrid Inbound Parse, a Gmail/Make/Zapier
 * forward-to-webhook) as long as it POSTs JSON:
 *   { "from": "Jane <jane@acme.ie>", "subject": "...", "text": "the reply body" }
 *
 * Auth: a shared secret in INBOUND_EMAIL_SECRET, sent as the `x-inbound-secret`
 * header or a `?secret=` query param. Disabled until the secret is configured,
 * so this can never be an open write endpoint. The mailbox itself remains the
 * guaranteed fallback — this is the automation on top, not the safety net.
 */

function extractEmail(from: unknown): string | null {
  // `from` may arrive as a raw string ("Jane <jane@acme.ie>") or, from a
  // provider webhook, as an object ({ address }/{ email }/{ value }). Normalise
  // to a string before pulling the address out.
  const raw =
    typeof from === "string"
      ? from
      : from && typeof from === "object"
        ? String(
            (from as { address?: string; email?: string; value?: string }).address ??
              (from as { email?: string }).email ??
              (from as { value?: string }).value ??
              ""
          )
        : "";
  const angled = /<([^>]+)>/.exec(raw);
  const candidate = (angled ? angled[1] : raw).trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(candidate) ? candidate : null;
}

export async function POST(request: NextRequest) {
  const secret = process.env.INBOUND_EMAIL_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "Inbound capture not configured" },
      { status: 503 }
    );
  }
  const provided =
    request.headers.get("x-inbound-secret") ??
    new URL(request.url).searchParams.get("secret") ??
    "";
  if (provided !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  // Accept several forwarder shapes without breaking the documented one:
  // fields at the top level ({from, subject, text}), or wrapped one level down
  // under `data` / `email` (Resend inbound, SendGrid, Mailgun and similar all
  // nest the message). Pick from the top level first, then the nested object.
  const src = (payload ?? {}) as Record<string, unknown>;
  const nested =
    ((src.data as Record<string, unknown> | undefined) ??
      (src.email as Record<string, unknown> | undefined) ??
      {}) as Record<string, unknown>;
  const pick = (key: string): unknown => src[key] ?? nested[key];

  const subjectRaw = pick("subject");
  const subject = typeof subjectRaw === "string" ? subjectRaw : "";
  // Prefer plain text; fall back to common body field names, then to stripped
  // HTML, so a forwarder that only sends an html body still captures the reply.
  const textRaw =
    pick("text") ?? pick("plain") ?? pick("body") ?? pick("text_body");
  let text = typeof textRaw === "string" ? textRaw.trim() : "";
  if (!text) {
    const html = pick("html");
    if (typeof html === "string") {
      text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    }
  }

  const senderEmail = extractEmail(pick("from"));
  if (!senderEmail || !text) {
    return NextResponse.json(
      { error: "Need a valid 'from' address and non-empty 'text'." },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  // Escape LIKE wildcards (ilike is only for case-insensitivity): _ is a
  // single-char wildcard and common in emails — unescaped, a reply from
  // john_smith@ could attach to the john.smith@ prospect instead.
  const senderPattern = senderEmail.replace(/([%_\\])/g, "\\$1");
  const { data: prospect } = await admin
    .from("ge_prospects")
    .select(
      "id, campaign_id, status, company, contact_name, job_title, industry, website, location, notes"
    )
    .ilike("email", senderPattern)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Not a tracked prospect (a booking reply, a stranger). The reply is still
  // safe in the mailbox; there's just nothing in the CRM to attach it to.
  if (!prospect) {
    return NextResponse.json({ ok: true, matched: false });
  }

  // Idempotency: forwarders retry. Skip if this exact reply was already
  // captured for this prospect in the last 15 minutes.
  const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { data: dupe } = await admin
    .from("ge_messages")
    .select("id")
    .eq("prospect_id", prospect.id)
    .eq("direction", "inbound")
    .eq("body", text.slice(0, 10000))
    .gte("created_at", since)
    .limit(1)
    .maybeSingle();
  if (dupe) {
    return NextResponse.json({ ok: true, matched: true, duplicate: true });
  }

  const { error } = await admin.from("ge_messages").insert({
    prospect_id: prospect.id,
    campaign_id: prospect.campaign_id,
    channel: "email",
    direction: "inbound",
    status: "received",
    subject: subject ? subject.slice(0, 300) : null,
    body: text.slice(0, 10000),
    sentiment: "neutral",
    created_by: null,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }

  // A reply resets the clock: answer within a day, not on the +3-day chase.
  // Only advance from pre-reply states so a later stage is never regressed.
  // Uses the autopilot's shared PRE_REPLY_STATUSES (not a hand-rolled copy):
  // the old list missed research_failed, leaving a replier in a pre-reply
  // status — which is exactly the state where the send-time gate lets a
  // queued cold touch through. Flipping to 'replied' makes the gate hold.
  if (PRE_REPLY_STATUSES.includes(prospect.status)) {
    await admin
      .from("ge_prospects")
      .update({ status: "replied", next_follow_up_at: dublinDate(1) })
      .eq("id", prospect.id);
  }

  await admin.from("ge_activities").insert({
    prospect_id: prospect.id,
    type: "email",
    content: `Reply received from ${senderEmail} — auto-captured into the inbox`,
    created_by: null,
  });

  // Auto-draft a suggested response so Jude opens the inbox to a reply already
  // written, not a blank box. Best-effort and never auto-sent — see autoDraftReply.
  const replyDrafted = await autoDraftReply(admin, prospect, text, null);

  return NextResponse.json({ ok: true, matched: true, replyDrafted });
}
