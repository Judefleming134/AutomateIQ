"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/require-session";
import { requireProductEnabled } from "@/lib/auth/require-product";
import { createClient } from "@/lib/supabase/server";
import {
  generateContentCore,
  CONTENT_TYPES,
  type ContentType,
} from "@/lib/content-agent/generate-core";
import { buildCampaignCore } from "@/lib/content-agent/campaign-core";

async function ctx() {
  const { profile } = await requireSession();
  const businessId = profile.business_id!;
  const enabled = await requireProductEnabled(businessId, "content-agent");
  const supabase = await createClient();
  return { businessId, enabled, supabase };
}

const inputSchema = z.object({
  contentType: z.enum(
    Object.keys(CONTENT_TYPES) as [ContentType, ...ContentType[]]
  ),
  topic: z.string().trim().min(3, "Give the topic a few words").max(300),
  notes: z.string().trim().max(1000).optional(),
});

export type GenerateResult =
  | { ok: true; content: string; saved: boolean }
  | { ok: false; error: string };

export async function generateContent(
  contentType: string,
  topic: string,
  notes: string
): Promise<GenerateResult> {
  const { businessId, enabled, supabase } = await ctx();
  if (!enabled) {
    return { ok: false, error: "Content Agent is not enabled for your account." };
  }

  const parsed = inputSchema.safeParse({ contentType, topic, notes: notes || undefined });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  return generateContentCore(
    supabase,
    businessId,
    parsed.data.contentType,
    parsed.data.topic,
    parsed.data.notes
  );
}

const campaignSchema = z.object({
  name: z.string().trim().min(2, "Name your campaign").max(160),
  goal: z.string().trim().max(500).optional(),
  theme: z.string().trim().min(3, "Describe the campaign theme").max(300),
});

export type CampaignResult =
  | { ok: true; created: number }
  | { ok: false; error: string };

/**
 * One-click multi-channel campaign: generates a blog, social posts and an
 * email in the business's voice and schedules them across the next week.
 */
export async function buildCampaign(
  name: string,
  goal: string,
  theme: string
): Promise<CampaignResult> {
  const { businessId, enabled, supabase } = await ctx();
  if (!enabled) return { ok: false, error: "Content Agent is not enabled." };

  const parsed = campaignSchema.safeParse({ name, goal: goal || undefined, theme });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const res = await buildCampaignCore(
    supabase,
    businessId,
    parsed.data.name,
    parsed.data.goal ?? "",
    parsed.data.theme
  );
  if (!res.ok) return res;
  revalidatePath("/portal/content-agent");
  return { ok: true, created: res.created };
}

export async function scheduleContent(id: string, date: string) {
  const { enabled, supabase } = await ctx();
  if (!enabled) return { ok: false as const, error: "Not enabled." };
  const { error } = await supabase
    .from("ca_content")
    .update({
      status: date ? "scheduled" : "draft",
      scheduled_for: date || null,
    })
    .eq("id", id);
  if (error) return { ok: false as const, error: error.message };
  revalidatePath("/portal/content-agent");
  return { ok: true as const };
}

export async function markPublished(id: string) {
  const { enabled, supabase } = await ctx();
  if (!enabled) return { ok: false as const, error: "Not enabled." };
  const { error } = await supabase
    .from("ca_content")
    .update({ status: "published", published_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false as const, error: error.message };
  revalidatePath("/portal/content-agent");
  return { ok: true as const };
}
