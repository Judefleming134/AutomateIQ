import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { generateContentCore, type ContentType } from "./generate-core";

/**
 * A campaign brief: what assets to produce. The ContentIQ generates the
 * whole set in the business's voice in one action — real batch automation,
 * not a single prompt. Each asset is scheduled a few days apart so the
 * campaign lands as a sequence, not all at once.
 */
export type CampaignPlanItem = {
  contentType: ContentType;
  topic: string;
  dayOffset: number; // days from today to schedule this asset
};

export type BuildCampaignResult =
  | { ok: true; campaignId: string; created: number }
  | { ok: false; error: string };

const DEFAULT_PLAN = (theme: string): CampaignPlanItem[] => [
  { contentType: "blog", topic: `Blog post: ${theme}`, dayOffset: 0 },
  { contentType: "social", topic: `Social posts announcing: ${theme}`, dayOffset: 1 },
  { contentType: "email", topic: `Customer email about: ${theme}`, dayOffset: 3 },
  { contentType: "social", topic: `Follow-up social posts for: ${theme}`, dayOffset: 5 },
];

export async function buildCampaignCore(
  supabase: SupabaseClient,
  businessId: string,
  name: string,
  goal: string,
  theme: string
): Promise<BuildCampaignResult> {
  const { data: campaign, error: campaignError } = await supabase
    .from("ca_campaigns")
    .insert({ business_id: businessId, name: name.slice(0, 160), goal: goal.slice(0, 500) })
    .select("id")
    .single();

  if (campaignError || !campaign) {
    if (campaignError?.code === "42P01") {
      return { ok: false, error: "Database update required — run supabase/manual_update_0008.sql." };
    }
    return { ok: false, error: campaignError?.message ?? "Could not create the campaign." };
  }

  const plan = DEFAULT_PLAN(theme);
  let created = 0;
  const today = new Date();

  // Generate assets sequentially so a rate-limited provider degrades
  // gracefully — whatever succeeds is saved and scheduled.
  for (const item of plan) {
    const result = await generateContentCore(
      supabase,
      businessId,
      item.contentType,
      item.topic,
      `Part of the "${name}" campaign. Goal: ${goal}.`
    );
    if (!result.ok) continue;

    // generateContentCore already saved a draft row; find the newest for
    // this type and attach it to the campaign + schedule it.
    const scheduled = new Date(today);
    scheduled.setDate(scheduled.getDate() + item.dayOffset);
    const { data: latest } = await supabase
      .from("ca_content")
      .select("id")
      .eq("business_id", businessId)
      .eq("content_type", item.contentType)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latest) {
      await supabase
        .from("ca_content")
        .update({
          campaign_id: campaign.id,
          status: "scheduled",
          scheduled_for: scheduled.toISOString().slice(0, 10),
        })
        .eq("id", latest.id);
      created += 1;
    }
  }

  if (created === 0) {
    return { ok: false, error: "Couldn't generate the campaign — check the AI key and try again." };
  }
  return { ok: true, campaignId: campaign.id, created };
}
