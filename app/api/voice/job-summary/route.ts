import { NextResponse, type NextRequest } from "next/server";
import crypto from "node:crypto";
import { getResendClient, getFromAddress } from "@/lib/email/resend";
import { secretsMatch } from "@/lib/security/timing-safe";
import { createAdminClient } from "@/lib/supabase/admin";
import { isMissingTableError } from "@/lib/db/errors";

/**
 * ElevenLabs voice-agent post-call webhook → an instant job email AND a job
 * row on the owning customer's dashboard (va_jobs → portal feed, Analytics,
 * and AssistIQ's read_voice_jobs tool).
 *
 * Point the agent's Post-call webhook at:
 *   https://automateiq.ie/api/voice/job-summary?secret=<ELEVENLABS_WEBHOOK_SECRET>
 * and add data-collection fields (caller_name, caller_phone, address, problem,
 * urgency, booking_slot — naming is alias-tolerant) in the agent's Analysis tab.
 *
 * Which dashboard a job lands on is resolved deterministically, in order:
 *   1. The payload's agent_id matched against va_config.elevenlabs_agent_id —
 *      the agent that took the call belongs to exactly one business. This is
 *      the ground truth and works no matter how many customers exist.
 *   2. VOICE_BUSINESS_ID env (explicit override).
 *   3. A single va_config row (unambiguous single-customer case).
 * The outcome — saved, where, or exactly why not — is appended to the job
 * email, so every test call verifies the whole pipeline end-to-end by itself.
 *
 * Duplicate webhook deliveries (ElevenLabs retries) are deduped by the call's
 * conversation_id when the va_jobs.conversation_id column exists (migration
 * 0024); without it, everything still works — retries could at worst repeat
 * a row, never lose one.
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
 *
 * GET (same secret) is a read-only preflight: it reports whether email is
 * configured, whether the va_jobs table exists, and which business a job
 * would land on — open it in a browser before a demo and check the greens.
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

type SupabaseAdmin = ReturnType<typeof createAdminClient>;

/**
 * Which business does this call belong to? Agent-id match is ground truth
 * (the agent that answered belongs to exactly one business), then the
 * explicit env override, then the unambiguous single-customer case.
 * Returns how it resolved too, so the email/preflight can say so.
 */
async function resolveBusiness(
  admin: SupabaseAdmin,
  agentId: string | null
): Promise<{ businessId: string | null; via: string }> {
  // Only route to LIVE businesses — a soft-deleted account (deleted_at set)
  // still has its va_config row, and would otherwise keep grabbing jobs by its
  // old agent ID after the customer was "deleted". Given candidate business
  // ids, return the first that isn't soft-deleted.
  const firstActive = async (ids: string[]): Promise<string | null> => {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return null;
    const { data } = await admin
      .from("businesses")
      .select("id")
      .in("id", unique)
      .is("deleted_at", null);
    return (data?.[0]?.id as string | undefined) ?? null;
  };

  if (agentId) {
    const { data } = await admin
      .from("va_config")
      .select("business_id")
      .eq("elevenlabs_agent_id", agentId);
    const id = await firstActive((data ?? []).map((r) => r.business_id as string));
    if (id) return { businessId: id, via: "agent ID match" };
  }
  const envId = process.env.VOICE_BUSINESS_ID?.trim();
  if (envId) return { businessId: envId, via: "VOICE_BUSINESS_ID" };
  // The unambiguous single-customer case — counted over LIVE businesses only.
  const { data: configs } = await admin
    .from("va_config")
    .select("business_id")
    .limit(50);
  const configIds = [...new Set((configs ?? []).map((r) => r.business_id as string))];
  const { data: liveBiz } = configIds.length
    ? await admin.from("businesses").select("id").in("id", configIds).is("deleted_at", null)
    : { data: [] as { id: string }[] };
  if (liveBiz && liveBiz.length === 1) {
    return { businessId: liveBiz[0].id as string, via: "only voice customer" };
  }
  return {
    businessId: null,
    via:
      liveBiz && liveBiz.length > 1
        ? "multiple voice customers and no agent ID matched — paste this agent's ID into Admin → Customers → Voice provisioning (or set VOICE_BUSINESS_ID)"
        : "no live voice customer is provisioned — assign VoiceIQ product and save provisioning in Admin → Customers",
  };
}

/** PGRST204 = PostgREST "column not found in schema cache"; 42703 = Postgres
 *  undefined_column. Either means migration 0024 hasn't run — retry without. */
function isMissingColumnError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; message?: string };
  return (
    e.code === "42703" ||
    e.code === "PGRST204" ||
    /column .* does not exist|could not find the .* column/i.test(e.message ?? "")
  );
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  // Trim: a trailing newline pasted into the Vercel env var would make an
  // otherwise-correct secret mismatch and 401.
  const sharedSecret = process.env.ELEVENLABS_WEBHOOK_SECRET?.trim();
  const signingSecret = process.env.ELEVENLABS_WEBHOOK_SIGNING_SECRET?.trim();
  if (!sharedSecret && !signingSecret) {
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }
  const provided = (
    request.headers.get("x-webhook-secret") ??
    new URL(request.url).searchParams.get("secret") ??
    ""
  ).trim();
  // Constant-time, like the HMAC branch three lines below already is. A plain
  // === returns as soon as two bytes differ, so the time to answer 401 tracks
  // how much of the secret the caller guessed — and this URL is public and
  // guessable, which is the exact case secretsMatch was extracted for.
  const sharedOk = Boolean(sharedSecret && secretsMatch(provided, sharedSecret));
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
    const parsed = JSON.parse(rawBody) as unknown;
    payload =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
  } catch {
    payload = null;
  }

  // ElevenLabs workspace webhooks can also deliver an audio event
  // (post_call_audio) that carries no job data. Skip ONLY that — fail OPEN for
  // everything else so a differently-named transcription event is never
  // silently dropped (that would capture the call but email/log nothing).
  const eventType = typeof payload?.type === "string" ? payload.type : "";
  if (eventType === "post_call_audio") {
    return NextResponse.json({ ok: true, skipped: eventType });
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
  const agentId =
    fieldValue(data?.agent_id) || fieldValue(payload?.agent_id) || null;
  const conversationId =
    fieldValue(data?.conversation_id) ||
    fieldValue(payload?.conversation_id) ||
    null;

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

  // ---- Dashboard write, BEFORE the email — so the email can report exactly
  // what happened. Every step is guarded: a DB hiccup can only ever change
  // the dashboard status line, never stop the job email.
  let businessName = "";
  let dashboardLine = "";
  let dbSaved = false;
  try {
    const admin = createAdminClient();
    const { businessId, via } = await resolveBusiness(admin, agentId);

    if (!businessId) {
      dashboardLine = `Dashboard: ⚠️ NOT saved — ${via}`;
    } else {
      const { data: biz } = await admin
        .from("businesses")
        .select("name")
        .eq("id", businessId)
        .maybeSingle();
      businessName = (biz?.name as string | undefined)?.trim() ?? "";
      const label = businessName || "the customer";

      // Dedupe retries by conversation id — guarded: if the column doesn't
      // exist yet (migration 0024 not run) we just skip deduping.
      let duplicate = false;
      if (conversationId) {
        try {
          const { data: existing, error: dupError } = await admin
            .from("va_jobs")
            .select("id")
            .eq("conversation_id", conversationId)
            .limit(1);
          if (!dupError && existing && existing.length > 0) duplicate = true;
        } catch {
          /* column not there yet — fine */
        }
      }

      if (duplicate) {
        dbSaved = true;
        dashboardLine = `Dashboard: ✅ already on ${label}'s portal (duplicate delivery ignored)`;
      } else {
        const row: Record<string, unknown> = {
          business_id: businessId,
          caller_name: name === "Unknown caller" ? "" : name,
          caller_phone: phone === "—" ? "" : phone,
          address: address === "—" ? "" : address,
          problem: problem === "—" ? "" : problem,
          urgency: urgency === "—" ? "" : urgency,
          booking_slot: slot === "—" ? "" : slot,
          summary,
        };
        let insertError: unknown = null;
        if (conversationId) {
          const { error } = await admin
            .from("va_jobs")
            .insert({ ...row, conversation_id: conversationId });
          insertError = error;
          if (error && isMissingColumnError(error)) {
            // Migration 0024 not run yet — save without the column.
            const { error: retryError } = await admin.from("va_jobs").insert(row);
            insertError = retryError;
          }
        } else {
          const { error } = await admin.from("va_jobs").insert(row);
          insertError = error;
        }

        if (!insertError) {
          dbSaved = true;
          dashboardLine = `Dashboard: ✅ saved to ${label}'s portal (${via})`;
        } else if (isMissingTableError(insertError)) {
          dashboardLine =
            "Dashboard: ⚠️ NOT saved — va_jobs table missing. Run supabase/manual_update_0023.sql in the Supabase SQL Editor.";
        } else {
          const msg =
            (insertError as { message?: string })?.message ?? "unknown error";
          dashboardLine = `Dashboard: ⚠️ NOT saved — ${msg.slice(0, 160)}`;
        }
      }
    }
  } catch (err) {
    console.error("Job-summary DB log failed (non-fatal):", err);
    dashboardLine =
      "Dashboard: ⚠️ NOT saved — database unreachable (check SUPABASE_SERVICE_ROLE_KEY). The job is only in this email.";
  }

  const lines = [
    `🔧 NEW JOB — ${businessName || "your business"}`,
    "",
    `Name: ${name}`,
    `Phone: ${phone}`,
    `Address: ${address}`,
    `Problem: ${problem}`,
    `Urgency: ${urgency}`,
    `Booked: ${slot}`,
  ];
  if (summary) lines.push("", `Call summary: ${summary}`);
  if (dashboardLine) lines.push("", dashboardLine);

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
      return NextResponse.json({ ok: false, dbSaved, detail: error.message });
    }
  } catch (err) {
    console.error("Job-summary email failed:", err);
    return NextResponse.json({ ok: false, dbSaved });
  }

  return NextResponse.json({ ok: true, dbSaved });
}

/**
 * Read-only preflight, same secret as the webhook: open
 *   https://automateiq.ie/api/voice/job-summary?secret=…&preflight=1
 * in a browser (the ?preflight=1 is optional) and confirm every check reads
 * true before a demo. Reports email config, table presence, and exactly which
 * business a captured job would land on — without sending anything.
 */
export async function GET(request: NextRequest) {
  const sharedSecret = process.env.ELEVENLABS_WEBHOOK_SECRET?.trim();
  const signingSecret = process.env.ELEVENLABS_WEBHOOK_SIGNING_SECRET?.trim();
  if (!sharedSecret && !signingSecret) {
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }
  const provided = (
    request.headers.get("x-webhook-secret") ??
    new URL(request.url).searchParams.get("secret") ??
    ""
  ).trim();
  // For a browser preflight, either configured secret is acceptable.
  if (
    !(sharedSecret && secretsMatch(provided, sharedSecret)) &&
    !(signingSecret && secretsMatch(provided, signingSecret))
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const report: Record<string, unknown> = {
    webhookAuth: {
      sharedSecret: Boolean(sharedSecret),
      elevenLabsHmac: Boolean(signingSecret),
    },
    email: {
      configured: Boolean(process.env.RESEND_API_KEY),
      from: getFromAddress(),
      to: (process.env.VOICE_SUMMARY_EMAIL || "judeautomated@gmail.com")
        .split(",")
        .map((e) => e.trim())
        .filter(Boolean),
    },
  };

  try {
    const admin = createAdminClient();

    // Every provisioned voice customer, and whether an agent ID is linked —
    // the linkage is what routes a call's job to the right dashboard.
    const { data: configs, error: cfgError } = await admin
      .from("va_config")
      .select("business_id, elevenlabs_agent_id, status, phone_number")
      .limit(10);
    if (cfgError) {
      report.voiceCustomers = `error: ${cfgError.message}`;
    } else {
      const withNames = await Promise.all(
        (configs ?? []).map(async (c) => {
          const { data: biz } = await admin
            .from("businesses")
            .select("name")
            .eq("id", c.business_id)
            .maybeSingle();
          return {
            business: (biz?.name as string | undefined) ?? c.business_id,
            status: c.status,
            phone: c.phone_number || null,
            agentIdLinked: Boolean(c.elevenlabs_agent_id),
          };
        })
      );
      report.voiceCustomers = withNames;
    }

    // Where would a job land if the payload's agent ID didn't match anything?
    const fallback = await resolveBusiness(admin, null);
    if (fallback.businessId) {
      const { data: biz } = await admin
        .from("businesses")
        .select("name")
        .eq("id", fallback.businessId)
        .maybeSingle();
      report.fallbackDestination = {
        business: (biz?.name as string | undefined) ?? fallback.businessId,
        via: fallback.via,
      };
    } else {
      report.fallbackDestination = { business: null, via: fallback.via };
    }

    const { error: jobsError } = await admin
      .from("va_jobs")
      .select("id", { count: "exact", head: true });
    report.vaJobsTable = jobsError
      ? `error: ${jobsError.message}`
      : "ok";

    report.ready =
      Boolean(process.env.RESEND_API_KEY) &&
      !jobsError &&
      (Array.isArray(report.voiceCustomers)
        ? report.voiceCustomers.some(
            (c) => (c as { agentIdLinked: boolean }).agentIdLinked
          ) || Boolean((report.fallbackDestination as { business: unknown }).business)
        : false);
  } catch (err) {
    report.database = `error: ${err instanceof Error ? err.message : "unreachable"}`;
    report.ready = false;
  }

  return NextResponse.json(report);
}
