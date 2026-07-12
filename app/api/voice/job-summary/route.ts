import { NextResponse, type NextRequest } from "next/server";
import { getResendClient, getFromAddress } from "@/lib/email/resend";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ElevenLabs voice-agent post-call webhook → an instant job email.
 *
 * When a call to the Castleknock reception agent ends, ElevenLabs POSTs the
 * captured details here and this emails a tidy job card to Jude — so the demo
 * (and, live, every real call) lands a "new job" in his inbox seconds after
 * hanging up, no Twilio/SMS required. Once Twilio is set up, an SMS can be
 * added alongside this without changing the agent.
 *
 * Point the agent's Post-call webhook at:
 *   https://automateiq.ie/api/voice/job-summary?secret=<ELEVENLABS_WEBHOOK_SECRET>
 * and add the data-collection fields caller_name, caller_phone, address,
 * problem, urgency, booking_slot in the agent's Analysis tab.
 *
 * Recipient: VOICE_SUMMARY_EMAIL (comma-separated) if set, else Jude's Gmail.
 * Secret-gated via ELEVENLABS_WEBHOOK_SECRET (header x-webhook-secret or
 * ?secret=); disabled until configured so it's never an open endpoint.
 */

/** ElevenLabs returns each collected field as { value, rationale } — or, in
 *  some versions, a bare scalar. Read either shape. */
function fieldValue(v: unknown): string {
  if (v && typeof v === "object" && "value" in v) {
    const inner = (v as { value?: unknown }).value;
    return inner == null ? "" : String(inner).trim();
  }
  return v == null ? "" : String(v).trim();
}

export async function POST(request: NextRequest) {
  const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }
  const provided =
    request.headers.get("x-webhook-secret") ??
    new URL(request.url).searchParams.get("secret") ??
    "";
  if (provided !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = (await request.json().catch(() => null)) as
    | Record<string, unknown>
    | null;

  // Support the real ElevenLabs shape (data.analysis.data_collection_results)
  // and a flat { fields, summary } shape for manual testing.
  const data = (payload?.data ?? payload) as Record<string, unknown> | undefined;
  const analysis = (data?.analysis ?? {}) as Record<string, unknown>;
  const collected = (analysis.data_collection_results ??
    (payload as Record<string, unknown>)?.fields ??
    {}) as Record<string, unknown>;
  const summary =
    fieldValue(analysis.transcript_summary) ||
    fieldValue((payload as Record<string, unknown>)?.summary);

  const name = fieldValue(collected.caller_name) || "Unknown caller";
  const phone = fieldValue(collected.caller_phone) || "—";
  const address = fieldValue(collected.address) || "—";
  const problem = fieldValue(collected.problem) || "—";
  const urgency = fieldValue(collected.urgency) || "—";
  const slot = fieldValue(collected.booking_slot) || "—";

  const lines = [
    "🔧 NEW JOB — Castleknock Plumbing",
    "",
    `Name: ${name}`,
    `Phone: ${phone}`,
    `Address: ${address}`,
    `Problem: ${problem}`,
    `Urgency: ${urgency}`,
    `Booked: ${slot}`,
  ];
  if (summary) lines.push("", `Call summary: ${summary}`);

  // Persist the captured job so the customer's portal shows a living list of
  // what their receptionist booked — not just an email that scrolls away.
  // Best-effort and fully isolated: a DB hiccup must never stop the job email.
  try {
    const admin = createAdminClient();
    // Resolve the owning business: an explicit VOICE_BUSINESS_ID wins; else,
    // if exactly one business has a voice agent configured, it's unambiguous
    // (the demo case). Anything else, skip DB logging — the email still lands.
    let businessId = process.env.VOICE_BUSINESS_ID?.trim() || null;
    if (!businessId) {
      const { data: configs } = await admin
        .from("va_config")
        .select("business_id")
        .limit(2);
      if (configs && configs.length === 1) businessId = configs[0].business_id;
    }
    if (businessId) {
      await admin.from("va_jobs").insert({
        business_id: businessId,
        caller_name: name === "Unknown caller" ? "" : name,
        caller_phone: phone === "—" ? "" : phone,
        address: address === "—" ? "" : address,
        problem: problem === "—" ? "" : problem,
        urgency: urgency === "—" ? "" : urgency,
        booking_slot: slot === "—" ? "" : slot,
        summary,
      });
    }
  } catch (err) {
    console.error("Job-summary DB log failed (non-fatal):", err);
  }

  const recipients = (
    process.env.VOICE_SUMMARY_EMAIL || "judeautomated@gmail.com"
  )
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);

  try {
    const resend = getResendClient();
    const { error } = await resend.emails.send({
      from: getFromAddress(),
      to: recipients,
      subject: `🔧 New job — ${name}${urgency && urgency !== "—" ? ` (${urgency})` : ""}`,
      text: lines.join("\n"),
    });
    if (error) {
      console.error("Job-summary email rejected:", error);
      // 200 anyway so ElevenLabs doesn't retry-storm; the call is over.
      return NextResponse.json({ ok: false, detail: error.message });
    }
  } catch (err) {
    console.error("Job-summary email failed:", err);
    return NextResponse.json({ ok: false });
  }

  return NextResponse.json({ ok: true });
}
