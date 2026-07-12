import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runCompanyResearch } from "@/lib/growth/research";
import {
  mapResearchError,
  parkResearchFailure,
  persistResearchResult,
} from "@/lib/growth/research-runner";
import { draftStudioMessage } from "@/lib/growth/ai";
import { loadGrowthSettings } from "@/lib/growth/auth";
import { pricingLines } from "@/lib/growth/pricing";
import { sanitizeOutreachBody, draftLooksBroken } from "@/lib/growth/email";
import { dublinDate } from "@/lib/growth/dates";
import type { ResearchReport } from "@/lib/growth/research";

// Two researches (~20-40s each on Gemini) must fit one invocation.
export const maxDuration = 60;

/**
 * The overnight research worker: each call researches up to 2 fresh
 * unresearched prospects — full report, score, contact backfill and the five
 * first-touch drafts — using EXACTLY the same runner as the on-page button.
 * Driven every 10 minutes overnight by a GitHub Action, it turns "import,
 * then click batches for an hour" into "import, sleep, wake to a researched
 * pipeline". The morning brief reports what it did via the "Jarvis nightly:"
 * activity prefix.
 *
 * Guard rails:
 * - Same CRON_SECRET auth as every other cron endpoint.
 * - Website-first ordering (research quality) with the stable id tiebreak.
 * - Skips the research_failed group entirely (those are Jude's to retry).
 * - Failures park the lead exactly like the button does; an ACCOUNT-level
 *   AI failure (credits/quota) aborts the run before wasting the second
 *   slot — the next scheduled call probes again cheaply.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Fresh leads only: never researched, not parked, not closed. Website
  // holders first — the engine reads the site, so they research best.
  const { data: researched } = await admin
    .from("ge_research")
    .select("prospect_id")
    .order("prospect_id");
  const researchedIds = new Set((researched ?? []).map((r) => r.prospect_id));

  const { data: candidates } = await admin
    .from("ge_prospects")
    .select("*")
    .not("status", "in", '("won","lost","do_not_contact","archived")')
    .not("status", "eq", "research_failed")
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .limit(400);

  const fresh = (candidates ?? [])
    .filter((p) => !researchedIds.has(p.id))
    .sort((a, b) => Number(Boolean(b.website)) - Number(Boolean(a.website)))
    .slice(0, 2);

  let done = 0;
  const notes: string[] = [];
  for (const prospect of fresh) {
    try {
      const result = await runCompanyResearch(prospect);
      const persisted = await persistResearchResult(
        admin,
        prospect,
        result,
        null,
        (score) =>
          `Jarvis nightly: researched ${prospect.company} while you slept (${
            result.websiteFetched ? "website analysed" : "website unreachable — inferred from details"
          }) — scored ${score}/100, outreach drafts ready`
      );
      if (persisted.ok) {
        done += 1;
        notes.push(`${prospect.company}: scored ${persisted.score}`);
      } else {
        notes.push(`${prospect.company}: persist failed (${persisted.error})`);
      }
    } catch (err) {
      const { friendly, accountDead, dailyQuota } = mapResearchError(err);
      await parkResearchFailure(admin, prospect, friendly, null);
      notes.push(`${prospect.company}: ${friendly.slice(0, 80)}`);
      // Account-level failure fails EVERY call identically — stop now,
      // don't burn the second slot. The next scheduled run re-probes.
      if (accountDead || dailyQuota) break;
    }
  }

  // Second skill: when the fresh-research queue is drained (or short), spend
  // the leftover slots DRAFTING DUE FOLLOW-UPS — prospects whose chase date
  // has arrived and who don't already have an unsent follow-up draft. Come
  // morning, every due chase greets Jude pre-written in the Studio.
  let followUpsDrafted = 0;
  const slots = 2 - fresh.length;
  if (slots > 0) {
    try {
      const today = dublinDate();
      const { data: due } = await admin
        .from("ge_prospects")
        .select("id, company, contact_name, job_title, industry, website, location, notes, campaign_id")
        .lte("next_follow_up_at", today)
        .in("status", ["contacted", "follow_up_sent"])
        .order("lead_score", { ascending: false, nullsFirst: false })
        .limit(20);
      const settings = await loadGrowthSettings();
      for (const p of due ?? []) {
        if (followUpsDrafted >= slots) break;
        // Skip anyone who already has an unsent follow-up draft waiting.
        const { data: existing } = await admin
          .from("ge_messages")
          .select("id")
          .eq("prospect_id", p.id)
          .eq("channel", "email")
          .eq("direction", "outbound")
          .eq("purpose", "follow_up")
          .in("status", ["draft", "queued"])
          .limit(1)
          .maybeSingle();
        if (existing) continue;
        const { data: research } = await admin
          .from("ge_research")
          .select("report, solutions")
          .eq("prospect_id", p.id)
          .maybeSingle();
        const keys = Array.isArray(research?.solutions)
          ? (research!.solutions as { key?: string }[])
              .map((s) => s.key)
              .filter((k): k is string => Boolean(k))
          : [];
        try {
          const draft = await draftStudioMessage(
            p,
            (research?.report as ResearchReport | undefined) ?? null,
            { channel: "email", purpose: "follow_up", tone: "professional" },
            settings.bookingUrl,
            pricingLines(keys)
          );
          const clean = sanitizeOutreachBody(draft.body);
          if (draftLooksBroken(clean)) continue; // never save a broken draft
          await admin.from("ge_messages").insert({
            prospect_id: p.id,
            campaign_id: p.campaign_id,
            channel: "email",
            direction: "outbound",
            status: "draft",
            purpose: "follow_up",
            tone: "professional",
            subject: draft.subject,
            body: clean,
            created_by: null,
          });
          followUpsDrafted += 1;
          notes.push(`${p.company}: follow-up drafted`);
          await admin.from("ge_activities").insert({
            prospect_id: p.id,
            type: "system",
            content: `Jarvis nightly: drafted the follow-up email (chase was due ${today}) — ready in the Studio`,
            created_by: null,
          });
        } catch (err) {
          const { accountDead, dailyQuota } = mapResearchError(err);
          if (accountDead || dailyQuota) break; // account-level: stop the run
          // One bad draft never blocks the rest.
        }
      }
    } catch (err) {
      notes.push(
        `follow-up drafting error: ${err instanceof Error ? err.message : "unknown"}`
      );
    }
  }

  if (done === 0 && followUpsDrafted === 0 && notes.length === 0) {
    return NextResponse.json({ ok: true, researched: 0, detail: "nothing to do" });
  }

  return NextResponse.json({
    ok: true,
    researched: done,
    followUpsDrafted,
    detail: notes.join("; ").slice(0, 500),
  });
}
