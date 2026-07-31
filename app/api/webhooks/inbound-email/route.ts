import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { dublinDate } from "@/lib/growth/dates";
import { autoDraftReply } from "@/lib/growth/reply-draft";
import { PRE_REPLY_STATUSES } from "@/lib/growth/autopilot";
import { classifyInbound } from "@/lib/growth/inbound-classify";

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

  // Headers, when the forwarder passes them. RFC 3834's `auto-submitted` is
  // conclusive for auto-replies, so it beats every text heuristic below.
  const headersRaw = pick("headers");
  const headers =
    headersRaw && typeof headersRaw === "object" && !Array.isArray(headersRaw)
      ? (headersRaw as Record<string, unknown>)
      : null;

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
      "id, campaign_id, status, company, contact_name, job_title, industry, website, location, notes, next_follow_up_at"
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

  // WHAT kind of inbound this is. An out-of-office and a "remove me" are not
  // replies, and treating them as one is what silently drained live leads out
  // of the automation — see lib/growth/inbound-classify.ts. When unsure it
  // says "human", which is exactly the behaviour that shipped before.
  const kind = classifyInbound(subject, text, headers);

  const { error } = await admin.from("ge_messages").insert({
    prospect_id: prospect.id,
    campaign_id: prospect.campaign_id,
    channel: "email",
    direction: "inbound",
    status: "received",
    subject: subject ? subject.slice(0, 300) : null,
    body: text.slice(0, 10000),
    sentiment: kind.kind === "opt_out" ? "negative" : "neutral",
    created_by: null,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }

  if (kind.kind === "auto_reply") {
    // An auto-responder is not a conversation. Log it (nothing is ever
    // discarded — it's in the timeline and the thread), but leave the status,
    // the chase sequence and the drafting budget alone.
    //
    // The one thing worth acting on is a return date: chasing someone the day
    // after their mailbox told us they're away until the 12th wastes the touch,
    // so push the follow-up out to the day they're back. Forward only, and only
    // from a pre-reply status, so this can never pull a chase earlier or
    // reschedule someone further down the pipeline.
    let deferredTo: string | null = null;
    if (
      kind.returnsOn &&
      PRE_REPLY_STATUSES.includes(prospect.status) &&
      kind.returnsOn > dublinDate(0) &&
      (!prospect.next_follow_up_at || kind.returnsOn > prospect.next_follow_up_at)
    ) {
      const { error: deferErr } = await admin
        .from("ge_prospects")
        .update({ next_follow_up_at: kind.returnsOn })
        .eq("id", prospect.id);
      if (!deferErr) deferredTo = kind.returnsOn;
    }

    await admin.from("ge_activities").insert({
      prospect_id: prospect.id,
      type: "email",
      content:
        `Auto-reply from ${senderEmail} (${kind.reason}) — logged, not counted as a reply. ` +
        (deferredTo
          ? `Chase moved to ${deferredTo}, when they're back.`
          : "Chase sequence left running."),
      created_by: null,
    });

    return NextResponse.json({
      ok: true,
      matched: true,
      classified: "auto_reply",
      deferredTo,
      replyDrafted: false,
    });
  }

  if (kind.kind === "opt_out") {
    // They asked to be left alone. Honouring that is an ePrivacy obligation,
    // not a courtesy — and `do_not_contact` is outside PRE_REPLY_STATUSES, so
    // it also holds any cold touch already queued for the 07:00 send.
    //
    // A won customer is the exception: flipping them out of the pipeline would
    // be destructive, so their follow-up is cleared and the request is logged
    // loudly instead.
    const closed = ["won", "do_not_contact"].includes(prospect.status);
    await admin
      .from("ge_prospects")
      .update(
        closed
          ? { next_follow_up_at: null }
          : { status: "do_not_contact", next_follow_up_at: null }
      )
      .eq("id", prospect.id);

    await admin.from("ge_activities").insert({
      prospect_id: prospect.id,
      type: "email",
      content: closed
        ? `${senderEmail} asked to be removed (${kind.reason}) — follow-ups cleared. Status left as '${prospect.status}'; review this one by hand.`
        : `${senderEmail} asked to be removed (${kind.reason}) — marked Do not contact, follow-ups cleared, no reply drafted.`,
      created_by: null,
    });

    return NextResponse.json({
      ok: true,
      matched: true,
      classified: "opt_out",
      replyDrafted: false,
    });
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

  return NextResponse.json({ ok: true, matched: true, classified: "human", replyDrafted });
}
