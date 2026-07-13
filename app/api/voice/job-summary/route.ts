import { NextResponse, type NextRequest } from "next/server";
import crypto from "node:crypto";
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
 *
 * Auth — either works, so it's robust to however the ElevenLabs webhook UI
 * ends up sending it:
 *   1. Shared secret: ELEVENLABS_WEBHOOK_SECRET, via ?secret= or the
 *      x-webhook-secret header. (Simplest — put ?secret=… in the webhook URL.)
 *   2. ElevenLabs' native HMAC: set ELEVENLABS_WEBHOOK_SIGNING_SECRET to the
 *      signing secret ElevenLabs shows when you create the post-call webhook,
 *      and the ElevenLabs-Signature header is verified.
 * Disabled (503) until at least one is configured, so it's never an open
 * endpoint.
 */

/**
 * Verifies ElevenLabs' `ElevenLabs-Signature` header — format
 * `t=<unix_ts>,v0=<hex hmac-sha256>` over `${t}.${rawBody}`, keyed by the
 * webhook signing secret. Rejects stale timestamps (30-min replay window).
 */
function verifyElevenLabsSignature(
  header: string | null,
  rawBody: string,
  secret: string
): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(
    header
      .split(",")
      .map((p) => p.split("=").map((s) => s.trim()))
      .filter((kv) => kv.length === 2)
  );
  const t = parts.t;
  const v0 = parts.v0;
  if (!t || !v0) return false;
  const age = Math.abs(Date.now() / 1000 - Number(t));
  if (!Number.isFinite(age) || age > 1800) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${t}.${rawBody}`)
    .digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(v0), Buffer.from(expected));
  } catch {
    return false;
  }
}

/** ElevenLabs returns each collected field as { value, rationale } — or, in
 *  some versions, a bare scalar. Read either shape. */
function fieldValue(v: unknown): string {
  if (v && typeof v === "object" && "value" in v) {
    const inner = (v as { value?: unknown }).value;
    return inner == null ? "" : String(inner).trim();
  }
  return v == null ? "" : String(v).trim();
}

/**
 * The receptionist should capture a job even if the ElevenLabs data-collection
 * fields aren't named exactly caller_name / caller_phone / etc. Build a
 * case-insensitive lookup over whatever keys came back, then read the first
 * non-empty value among a field's known aliases — so a field typed as "name",
 * "phone" or "issue" still lands in the right slot instead of silently
 * dropping to "—". This is what makes the setup forgiving of small config
 * differences on the ElevenLabs side.
 */
function makePicker(collected: Record<string, unknown>) {
  const byLower = new Map<string, unknown>();
  for (const [k, v] of Object.entries(collected)) {
    byLower.set(k.toLowerCase().replace(/[\s-]+/g, "_"), v);
  }
  return (aliases: string[]): string => {
    for (const a of aliases) {
      const v = byLower.get(a);
      const s = fieldValue(v);
      if (s) return s;
    }
    return "";
  };
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  const sharedSecret = process.env.ELEVENLABS_WEBHOOK_SECRET;
  const signingSecret = process.env.ELEVENLABS_WEBHOOK_SIGNING_SECRET;
  if (!sharedSecret && !signingSecret) {
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }
  const provided =
    request.headers.get("x-webhook-secret") ??
    new URL(request.url).searchParams.get("secret") ??
    "";
  const sharedOk = Boolean(sharedSecret) && provided === sharedSecret;
  const hmacOk =
    Boolean(signingSecret) &&
    verifyElevenLabsSignature(
      request.headers.get("elevenlabs-signature"),
      rawBody,
      signingSecret as string
    );
  if (!sharedOk && !hmacOk) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: Record<string, unknown> | null;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    payload = null;
  }

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

  // Read each field by its known aliases, so the job still captures cleanly
  // even if the ElevenLabs data-collection fields are named a little
  // differently (name vs caller_name, phone vs caller_phone, issue vs problem).
  const pick = makePicker(collected);
  const name =
    pick(["caller_name", "name", "customer_name", "full_name", "caller"]) ||
    "Unknown caller";
  const phone =
    pick([
      "caller_phone",
      "phone",
      "phone_number",
      "number",
      "contact",
      "contact_number",
      "mobile",
    ]) || "—";
  const address =
    pick(["address", "job_address", "location", "callout_address", "eircode"]) ||
    "—";
  const problem =
    pick([
      "problem",
      "issue",
      "job",
      "job_description",
      "reason",
      "description",
      "enquiry",
      "inquiry",
    ]) || "—";
  const urgency =
    pick(["urgency", "priority", "emergency", "how_urgent"]) || "—";
  const slot =
    pick([
      "booking_slot",
      "slot",
      "appointment",
      "appointment_time",
      "booking",
      "preferred_time",
      "preferred_slot",
      "time",
      "date",
    ]) || "—";

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
