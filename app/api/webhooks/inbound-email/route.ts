import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { dublinDate } from "@/lib/growth/dates";
import { draftOutreach } from "@/lib/growth/ai";
import { loadGrowthSettings } from "@/lib/growth/auth";
import { sanitizeOutreachBody, draftLooksBroken } from "@/lib/growth/email";

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

function extractEmail(from: string): string | null {
  const angled = /<([^>]+)>/.exec(from);
  const candidate = (angled ? angled[1] : from).trim().toLowerCase();
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

  const payload = (await request.json().catch(() => null)) as {
    from?: unknown;
    subject?: unknown;
    text?: unknown;
  } | null;
  const from = typeof payload?.from === "string" ? payload.from : "";
  const subject = typeof payload?.subject === "string" ? payload.subject : "";
  const text = typeof payload?.text === "string" ? payload.text.trim() : "";

  const senderEmail = extractEmail(from);
  if (!senderEmail || !text) {
    return NextResponse.json(
      { error: "Need a valid 'from' address and non-empty 'text'." },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const { data: prospect } = await admin
    .from("ge_prospects")
    .select(
      "id, campaign_id, status, company, contact_name, job_title, industry, website, location, notes"
    )
    .ilike("email", senderEmail)
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
  if (
    ["new", "researching", "research_complete", "outreach_ready",
     "contacted", "follow_up_sent"].includes(prospect.status)
  ) {
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
  // written, not a blank box. Strictly best-effort and NEVER auto-sent: it's a
  // draft in the Studio, gated by the same broken-draft check as every other
  // path. Any failure here leaves the captured reply untouched.
  let replyDrafted = false;
  try {
    // One suggested reply at a time — don't stack drafts if a forwarder double-
    // fires or the prospect sends a second message before Jude has sent the first.
    const { data: pending } = await admin
      .from("ge_messages")
      .select("id")
      .eq("prospect_id", prospect.id)
      .eq("channel", "email")
      .eq("direction", "outbound")
      .eq("purpose", "reply")
      .eq("status", "draft")
      .limit(1)
      .maybeSingle();
    if (!pending) {
      const settings = await loadGrowthSettings();
      const draft = await draftOutreach(
        {
          company: prospect.company,
          contact_name: prospect.contact_name,
          job_title: prospect.job_title,
          industry: prospect.industry,
          website: prospect.website,
          location: prospect.location,
          notes: prospect.notes,
        },
        { channel: "email", objective: "reply", tone: "professional", replyContext: text.slice(0, 4000) },
        settings.bookingUrl
      );
      const clean = sanitizeOutreachBody(draft.body);
      if (!draftLooksBroken(clean)) {
        await admin.from("ge_messages").insert({
          prospect_id: prospect.id,
          campaign_id: prospect.campaign_id,
          channel: "email",
          direction: "outbound",
          status: "draft",
          purpose: "reply",
          tone: "professional",
          subject: draft.subject,
          body: clean,
          created_by: null,
        });
        replyDrafted = true;
        await admin.from("ge_activities").insert({
          prospect_id: prospect.id,
          type: "system",
          content: "Jarvis: drafted a suggested reply to their message — ready to review and send in the inbox",
          created_by: null,
        });
      }
    }
  } catch {
    // Drafting is a bonus; the captured reply is what matters. Swallow.
  }

  return NextResponse.json({ ok: true, matched: true, replyDrafted });
}
