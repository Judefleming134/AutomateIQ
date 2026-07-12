import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadGrowthSettings } from "@/lib/growth/auth";
import { runCompanyResearch, cleanSocialUrl } from "@/lib/growth/research";
import { estimatedFirstYearValue } from "@/lib/growth/pricing";
import { NO_PROVIDER_MESSAGE } from "@/lib/ai/config";
import {
  computeLeadScore,
  qualificationFromScore,
  CRITERIA,
  type CriterionKey,
} from "@/lib/growth/scoring";

/**
 * The research pipeline's shared persistence half, used by BOTH the
 * user-facing "Research" action and the overnight research worker — one
 * implementation, so the unattended path can never drift from what the
 * button does: ge_research upsert, score, prospect update (status, contact
 * backfill, pipeline €), the five first-touch drafts, and the timeline entry.
 */

type ResearchResult = Awaited<ReturnType<typeof runCompanyResearch>>;
type Admin = SupabaseClient;

/**
 * Maps a runCompanyResearch throw to the user-facing message. EXACT wording
 * matters: the batch queue pattern-matches these strings ("AI CREDITS
 * EMPTY", "DAILY AI QUOTA", "rate limit") to stop instantly or pace itself,
 * and the worker uses `accountDead`/`daily` to stop a whole run.
 */
export function mapResearchError(err: unknown): {
  friendly: string;
  accountDead: boolean;
  dailyQuota: boolean;
} {
  const message = err instanceof Error ? err.message : "";
  const accountDead =
    /credit balance/i.test(message) ||
    (message.startsWith("HTTP 400") &&
      /invalid_request_error/i.test(message) &&
      /\bYou\b/.test(message));
  let friendly: string;
  let dailyQuota = false;
  if (message === "NO_PROVIDER") friendly = NO_PROVIDER_MESSAGE;
  else if (accountDead) {
    friendly =
      "AI CREDITS EMPTY — the Anthropic account can't accept requests (credit balance / billing). Top up at console.anthropic.com → Billing, then hit Retry. Failed attempts cost nothing, and your leads are untouched.";
  } else if (message === "BAD_JSON") {
    friendly = "The research came back malformed — run it again.";
  } else if (message.startsWith("HTTP 429")) {
    dailyQuota = /perday|per_day|per day|daily|quota/i.test(message);
    friendly = dailyQuota
      ? "DAILY AI QUOTA reached — the free tier has used its calls for today. It resets daily; adding ANTHROPIC_API_KEY in Vercel removes the cap."
      : "AI rate limit — pausing a minute fixes this.";
  } else if (/^HTTP 5\d\d/.test(message)) {
    friendly = "AI service briefly overloaded — retry in a minute.";
  } else {
    friendly = `Research failed${message.startsWith("HTTP") ? ` (${message.slice(0, 80)})` : ""} — try again in a moment.`;
  }
  return { friendly, accountDead, dailyQuota };
}

/**
 * Parks a failed lead in the research_failed group (pre-research statuses
 * only — a failed re-research never yanks a contacted lead out of the live
 * pipeline) and stamps the why on its timeline.
 */
export async function parkResearchFailure(
  admin: Admin,
  prospect: { id: string; status: string },
  friendly: string,
  createdBy: string | null
): Promise<void> {
  if (["new", "researching"].includes(prospect.status)) {
    await admin
      .from("ge_prospects")
      .update({ status: "research_failed" })
      .eq("id", prospect.id);
  }
  await admin.from("ge_activities").insert({
    prospect_id: prospect.id,
    type: "system",
    content: `Research failed: ${friendly.slice(0, 200)}`,
    created_by: createdBy,
  });
}

/**
 * Persists a successful research run. `actorLabel` names who ran it in the
 * timeline entry ("Jude", or "Jarvis overnight" for the worker — the
 * "Jarvis nightly:" prefix on the worker's entries is what surfaces them in
 * the morning brief's overnight section).
 */
export async function persistResearchResult(
  admin: Admin,
  prospect: Record<string, unknown> & { id: string; status: string },
  result: ResearchResult,
  createdBy: string | null,
  activityContent: (score: number) => string
): Promise<{ ok: true; score: number } | { ok: false; error: string }> {
  const id = prospect.id;
  const { error: researchError } = await admin.from("ge_research").upsert(
    {
      prospect_id: id,
      // engine rides inside the report jsonb so the UI can show which model
      // produced this research without a schema change.
      report: { ...result.report, engine: result.engine },
      solutions: result.solutions,
      website_fetched: result.websiteFetched,
      created_by: createdBy,
    },
    { onConflict: "prospect_id" }
  );
  if (researchError) return { ok: false, error: researchError.message };

  // Lead score: AI ratings fill in criteria nobody has rated yet; a human's
  // existing non-zero rating always wins over the model's estimate.
  const ratings: Partial<Record<CriterionKey, number>> = {};
  for (const c of CRITERIA) {
    const current = Number(prospect[c.key] ?? 0);
    ratings[c.key] = current > 0 ? current : (result.ratings[c.key] ?? 0);
  }
  const settings = await loadGrowthSettings();
  const score = computeLeadScore(ratings);

  const update: Record<string, unknown> = {
    ...ratings,
    lead_score: score,
    qualification_status: qualificationFromScore(
      score,
      settings,
      prospect.qualification_status as string
    ),
  };
  if (!prospect.industry && result.report.industry) {
    update.industry = result.report.industry;
  }
  // Ground pipeline € in the price book: conservative first-year value of
  // the top recommendations. Never overwrites a figure a human entered.
  if (prospect.pipeline_value == null && result.solutions.length > 0) {
    const estimate = estimatedFirstYearValue(result.solutions.map((s) => s.key));
    if (estimate > 0) update.pipeline_value = estimate;
  }
  if (["new", "researching", "research_failed"].includes(prospect.status)) {
    // A successful retry lifts a parked lead straight out of the failed group.
    update.status = "research_complete";
  }
  // Contact details harvested from the company's own website fill any blank
  // CRM fields — a human-entered value is never overwritten. Social links
  // are the exception: a saved link that fails cleanSocialUrl is machine
  // junk (bare facebook.com, fbml tags, share links), so it's replaced
  // with a fresh find or cleared rather than left as a dead DM target.
  for (const key of ["email", "phone"] as const) {
    if (!prospect[key] && result.found[key]) update[key] = result.found[key];
  }
  for (const key of ["instagram_url", "facebook_url", "linkedin_url"] as const) {
    const existingDead =
      prospect[key] && cleanSocialUrl(prospect[key] as string) === null;
    if ((!prospect[key] || existingDead) && result.found[key]) {
      update[key] = result.found[key];
    } else if (existingDead) {
      update[key] = null;
    }
  }
  await admin.from("ge_prospects").update(update).eq("id", id);

  // First-touch drafts per channel: refresh existing unsent drafts in place,
  // create the missing ones.
  const draftFor: Record<string, { subject: string | null; body: string }> = {
    linkedin: { subject: null, body: result.drafts.linkedin },
    instagram: { subject: null, body: result.drafts.instagram },
    facebook: { subject: null, body: result.drafts.facebook },
    email: { subject: result.drafts.email.subject, body: result.drafts.email.body },
    sms: { subject: null, body: result.drafts.sms },
  };
  for (const [channel, draft] of Object.entries(draftFor)) {
    if (!draft.body) continue;
    const { data: existing } = await admin
      .from("ge_messages")
      .select("id")
      .eq("prospect_id", id)
      .eq("channel", channel)
      .eq("purpose", "first")
      .eq("status", "draft")
      .maybeSingle();
    if (existing) {
      await admin
        .from("ge_messages")
        .update({
          subject: draft.subject,
          body: draft.body,
          tone: "professional",
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
    } else {
      await admin.from("ge_messages").insert({
        prospect_id: id,
        campaign_id: prospect.campaign_id ?? null,
        channel,
        direction: "outbound",
        status: "draft",
        purpose: "first",
        tone: "professional",
        subject: draft.subject,
        body: draft.body,
        created_by: createdBy,
      });
    }
  }

  await admin.from("ge_activities").insert({
    prospect_id: id,
    type: "system",
    content: activityContent(score),
    created_by: createdBy,
  });

  return { ok: true, score };
}
