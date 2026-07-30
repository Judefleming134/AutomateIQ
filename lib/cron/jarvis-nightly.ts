import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadGrowthSettings } from "@/lib/growth/auth";
import { cleanSocialUrl, fetchWebsiteText } from "@/lib/growth/research";
import { draftStudioMessage } from "@/lib/growth/ai";
import { pricingLines } from "@/lib/growth/pricing";
import { sanitizeOutreachBody, draftLooksBroken } from "@/lib/growth/email";
import { PURPOSES, type MessagePurpose } from "@/lib/growth/constants";
import type { ResearchReport } from "@/lib/growth/research";
import { dublinDate } from "@/lib/growth/dates";

const ACTIVE_FILTER = '("won","lost","do_not_contact","archived")';

/**
 * Jarvis's own nightly routine (10pm Irish cron): unattended data hygiene
 * so mornings start clean. Two jobs, each hard-capped to fit the function
 * budget:
 *   1. Contact harvest — read websites of prospects missing an email and
 *      fill blank contact fields (no AI usage).
 *   2. Draft repair — find outdated email drafts (placeholders / invented
 *      senders) and rewrite them under current rules (small AI budget).
 * Every fix is logged as a prospect activity prefixed "Jarvis nightly:" so
 * the 8am morning brief can report what the routine did.
 */
/** How many exhausted leads get parked per night — bounded like every other
 *  job here, so the backlog just rolls into tomorrow's run. */
const RECYCLE_PER_NIGHT = 40;
/** How long before a parked lead comes back around. Long enough that a fresh
 *  approach is genuinely fresh, short enough to matter this quarter. */
const RECYCLE_DAYS = 75;
/** Two full sequences with total silence is an answer. A third is harassment. */
const MAX_RECYCLES = 2;

export async function runJarvisNightly(): Promise<{
  harvested: number;
  rewritten: number;
  recycled: number;
  detail: string;
}> {
  const admin = createAdminClient();
  const notes: string[] = [];

  // ---- Job 1: contact harvest (≤8 sites, ~2s each, zero AI) ----
  // Budget maths for the whole routine: 8 + 6 site reads at the 8s fetch
  // timeout worst-case must coexist with 3 AI rewrites inside maxDuration
  // 60 — caps are deliberately conservative; the backlog just rolls to
  // tomorrow's run.
  let harvested = 0;
  try {
    const { data: missing } = await admin
      .from("ge_prospects")
      .select("id, company, website, email, phone, instagram_url, facebook_url, linkedin_url")
      .not("website", "is", null)
      .is("email", null)
      .not("status", "in", ACTIVE_FILTER)
      .order("lead_score", { ascending: false, nullsFirst: false })
      .limit(8);
    for (const p of missing ?? []) {
      const site = await fetchWebsiteText(p.website as string).catch(() => null);
      if (!site) continue;
      const update: Record<string, string> = {};
      for (const key of ["email", "phone", "instagram_url", "facebook_url", "linkedin_url"] as const) {
        if (!p[key] && site.found[key]) update[key] = site.found[key]!;
      }
      if (Object.keys(update).length === 0) continue;
      const { error } = await admin.from("ge_prospects").update(update).eq("id", p.id);
      if (error) continue;
      harvested += 1;
      await admin.from("ge_activities").insert({
        prospect_id: p.id,
        type: "system",
        content: `Jarvis nightly: found ${Object.keys(update).map((k) => k.replace("_url", "")).join(", ")} on their website`,
        created_by: null,
      });
    }
  } catch (err) {
    notes.push(`harvest error: ${err instanceof Error ? err.message : "unknown"}`);
  }

  // ---- Job 1b: repair dead social links (≤8 sites, zero AI) ----
  // The old harvester saved junk (bare facebook.com, fbml tags, share
  // links). Re-read those sites with the fixed harvester; replace or clear.
  let socialsFixed = 0;
  try {
    const { data: withSocials } = await admin
      .from("ge_prospects")
      .select("id, company, website, instagram_url, facebook_url, linkedin_url")
      .not("website", "is", null)
      .or("instagram_url.not.is.null,facebook_url.not.is.null,linkedin_url.not.is.null")
      .not("status", "in", ACTIVE_FILTER)
      .limit(200);
    const damaged = (withSocials ?? []).filter((p) =>
      (["instagram_url", "facebook_url", "linkedin_url"] as const).some(
        (k) => p[k] && cleanSocialUrl(p[k]) === null
      )
    );
    for (const p of damaged.slice(0, 6)) {
      const site = await fetchWebsiteText(p.website as string).catch(() => null);
      const update: Record<string, string | null> = {};
      const fixedKinds: string[] = [];
      for (const key of ["instagram_url", "facebook_url", "linkedin_url"] as const) {
        if (!p[key] || cleanSocialUrl(p[key]) !== null) continue;
        const fresh = site?.found[key] ?? null;
        update[key] = fresh;
        fixedKinds.push(`${key.replace("_url", "")} ${fresh ? "replaced" : "cleared"}`);
      }
      if (fixedKinds.length === 0) continue;
      const { error } = await admin.from("ge_prospects").update(update).eq("id", p.id);
      if (error) continue;
      socialsFixed += 1;
      await admin.from("ge_activities").insert({
        prospect_id: p.id,
        type: "system",
        content: `Jarvis nightly: repaired dead social links (${fixedKinds.join(", ")})`,
        created_by: null,
      });
    }
    if (damaged.length > 6) {
      notes.push(`${damaged.length - 6} more dead social links queued for tomorrow's run`);
    }
  } catch (err) {
    notes.push(`social-repair error: ${err instanceof Error ? err.message : "unknown"}`);
  }

  // ---- Job 2: repair outdated email drafts (≤4 rewrites, low effort) ----
  let rewritten = 0;
  try {
    const { data: drafts } = await admin
      .from("ge_messages")
      .select("id, prospect_id, body, status, purpose")
      .eq("channel", "email")
      .eq("direction", "outbound")
      .in("status", ["draft", "queued"])
      .order("created_at", { ascending: false })
      .limit(60);
    const broken = (drafts ?? []).filter((d) =>
      draftLooksBroken(sanitizeOutreachBody(d.body))
    );
    if (broken.length > 0) {
      const settings = await loadGrowthSettings();
      for (const d of broken.slice(0, 3)) {
        const { data: prospect } = await admin
          .from("ge_prospects")
          .select("id, company, contact_name, job_title, industry, website, location, notes")
          .eq("id", d.prospect_id)
          .maybeSingle();
        if (!prospect) continue;
        const { data: research } = await admin
          .from("ge_research")
          .select("report, solutions")
          .eq("prospect_id", d.prospect_id)
          .maybeSingle();
        const keys = Array.isArray(research?.solutions)
          ? (research!.solutions as { key?: string }[])
              .map((s) => s.key)
              .filter((k): k is string => Boolean(k))
          : [];
        try {
          // Preserve what the draft IS: rewriting a broken follow-up as a
          // "first touch" would send the prospect a second cold intro as
          // their chase. Unknown/legacy purposes fall back to first.
          const purpose = PURPOSES.includes(d.purpose as MessagePurpose)
            ? (d.purpose as MessagePurpose)
            : "first";
          const draft = await draftStudioMessage(
            prospect,
            (research?.report as ResearchReport | undefined) ?? null,
            { channel: "email", purpose, tone: "professional" },
            settings.bookingUrl,
            pricingLines(keys)
          );
          const clean = sanitizeOutreachBody(draft.body);
          if (draftLooksBroken(clean)) continue;
          await admin
            .from("ge_messages")
            .update({ subject: draft.subject, body: clean, tone: "professional", updated_at: new Date().toISOString() })
            .eq("id", d.id);
          rewritten += 1;
          await admin.from("ge_activities").insert({
            prospect_id: d.prospect_id,
            type: "system",
            content: "Jarvis nightly: rewrote an outdated email draft under current rules",
            created_by: null,
          });
        } catch {
          // AI hiccup on one draft never blocks the rest of the routine.
        }
      }
      // The loop above rewrites at most 3 — anything beyond that genuinely
      // remains (an off-by-one here silently hid the 4th broken draft from
      // the morning brief's note).
      if (broken.length > 3) {
        notes.push(`${broken.length - 3} more outdated drafts remain for tomorrow's run`);
      }
    }
  } catch (err) {
    notes.push(`draft-repair error: ${err instanceof Error ? err.message : "unknown"}`);
  }

  // ---- Job 4: recycle the exhausted ----------------------------------------
  //
  // THE HOLE THIS FILLS: nothing in the engine ever moved a lead to
  // future_opportunity. A lead got a first touch, two chases, then silence —
  // and after seven days it fell into "gone cold" and stayed there forever
  // with a stale follow-up date and nothing scheduled. On a list of 757 that
  // means every lead is exhausted within about three weeks and the engine
  // runs out of work, despite most of those businesses simply not having
  // replied the first time.
  //
  // Most B2B replies come from a later approach, not the first one. So a lead
  // that finished the sequence without EVER replying is parked as a future
  // opportunity with a real date on it, and comes back around for a fresh
  // sequence with current research.
  //
  // Deliberately conservative about who qualifies:
  //   - never replied (one inbound message ever and it's a conversation, not
  //     a cold lead — those are Jude's to work)
  //   - finished the sequence (2 sent chases) OR went 7+ days past its date
  //   - still has a usable email (a bounce nulls it, so a dead address is
  //     never recycled into more bounces)
  //   - not closed, not do-not-contact, not already parked
  let recycled = 0;
  try {
    const coldLine = dublinDate(-7);
    const { data: stalled } = await admin
      .from("ge_prospects")
      .select("id, company, next_follow_up_at")
      .in("status", ["contacted", "follow_up_sent"])
      .not("email", "is", null)
      .lt("next_follow_up_at", coldLine)
      .order("lead_score", { ascending: false, nullsFirst: false })
      .limit(RECYCLE_PER_NIGHT);

    for (const p of stalled ?? []) {
      // Never recycle someone who has spoken to us. A reply makes this a
      // conversation, and an automated re-approach on top of a real one is
      // exactly the thing that makes a company look like a spammer.
      const { count: replies } = await admin
        .from("ge_messages")
        .select("id", { count: "exact", head: true })
        .eq("prospect_id", p.id)
        .eq("direction", "inbound");
      if ((replies ?? 0) > 0) continue;

      // Cap the cycles. Twice through a sequence with total silence is a
      // clear answer, and a third pass is harassment dressed as automation.
      const { count: priorCycles } = await admin
        .from("ge_activities")
        .select("id", { count: "exact", head: true })
        .eq("prospect_id", p.id)
        .ilike("content", "Jarvis nightly: parked % re-approach%");
      if ((priorCycles ?? 0) >= MAX_RECYCLES) continue;

      const revives = dublinDate(RECYCLE_DAYS);
      const { error } = await admin
        .from("ge_prospects")
        .update({ status: "future_opportunity", next_follow_up_at: revives })
        .eq("id", p.id)
        // Guard the write: if a reply landed between the read and here, the
        // status has moved on and this must not drag them back.
        .in("status", ["contacted", "follow_up_sent"]);
      if (error) continue;

      recycled += 1;
      await admin.from("ge_activities").insert({
        prospect_id: p.id,
        type: "system",
        content: `Jarvis nightly: parked ${p.company} for a re-approach on ${revives} — the full sequence went out and they never replied, so they come back around with fresh research rather than sitting in gone-cold forever`,
        created_by: null,
      });
    }
    if (recycled > 0) notes.push(`parked ${recycled} exhausted leads for a later re-approach`);
  } catch (err) {
    notes.push(`recycle error: ${err instanceof Error ? err.message : "unknown"}`);
  }

  return {
    harvested,
    rewritten,
    recycled,
    detail: [
      `harvested contacts for ${harvested}`,
      `repaired socials on ${socialsFixed}`,
      `rewrote ${rewritten} drafts`,
      `recycled ${recycled}`,
      ...notes,
    ].join("; "),
  };
}
