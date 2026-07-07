import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadGrowthSettings } from "@/lib/growth/auth";
import { cleanSocialUrl, fetchWebsiteText } from "@/lib/growth/research";
import { draftStudioMessage } from "@/lib/growth/ai";
import { pricingLines } from "@/lib/growth/pricing";
import { sanitizeOutreachBody, draftLooksBroken } from "@/lib/growth/email";
import type { ResearchReport } from "@/lib/growth/research";

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
export async function runJarvisNightly(): Promise<{
  harvested: number;
  rewritten: number;
  detail: string;
}> {
  const admin = createAdminClient();
  const notes: string[] = [];

  // ---- Job 1: contact harvest (≤12 sites, ~2s each, zero AI) ----
  let harvested = 0;
  try {
    const { data: missing } = await admin
      .from("ge_prospects")
      .select("id, company, website, email, phone, instagram_url, facebook_url, linkedin_url")
      .not("website", "is", null)
      .is("email", null)
      .not("status", "in", ACTIVE_FILTER)
      .order("lead_score", { ascending: false, nullsFirst: false })
      .limit(12);
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
    for (const p of damaged.slice(0, 8)) {
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
    if (damaged.length > 8) {
      notes.push(`${damaged.length - 8} more dead social links queued for tomorrow's run`);
    }
  } catch (err) {
    notes.push(`social-repair error: ${err instanceof Error ? err.message : "unknown"}`);
  }

  // ---- Job 2: repair outdated email drafts (≤4 rewrites, low effort) ----
  let rewritten = 0;
  try {
    const { data: drafts } = await admin
      .from("ge_messages")
      .select("id, prospect_id, body, status")
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
      for (const d of broken.slice(0, 4)) {
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
          const draft = await draftStudioMessage(
            prospect,
            (research?.report as ResearchReport | undefined) ?? null,
            { channel: "email", purpose: "first", tone: "professional" },
            settings.bookingUrl,
            pricingLines(keys)
          );
          const clean = sanitizeOutreachBody(draft.body);
          if (draftLooksBroken(clean)) continue;
          await admin
            .from("ge_messages")
            .update({ subject: draft.subject, body: clean, tone: "professional" })
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
      if (broken.length > 4) {
        notes.push(`${broken.length - 4} more outdated drafts remain for tomorrow's run`);
      }
    }
  } catch (err) {
    notes.push(`draft-repair error: ${err instanceof Error ? err.message : "unknown"}`);
  }

  return {
    harvested,
    rewritten,
    detail: [
      `harvested contacts for ${harvested}`,
      `repaired socials on ${socialsFixed}`,
      `rewrote ${rewritten} drafts`,
      ...notes,
    ].join("; "),
  };
}
