"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireGrowth } from "@/lib/growth/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { CAMPAIGN_STATUSES } from "@/lib/growth/constants";

type Result = { ok?: boolean; error?: string } | undefined;

const campaignSchema = z.object({
  name: z.string().trim().min(1, "Campaign name is required.").max(200),
  description: z
    .string()
    .trim()
    .max(2000)
    .transform((v) => v || null)
    .nullable()
    .optional(),
  channel: z.enum(["linkedin", "instagram", "facebook", "email", "sms", "call", "multi"]),
  industry: z.string().trim().max(200).transform((v) => v || null).nullable().optional(),
  service: z.string().trim().max(200).transform((v) => v || null).nullable().optional(),
  location: z.string().trim().max(200).transform((v) => v || null).nullable().optional(),
  target_audience: z.string().trim().max(500).transform((v) => v || null).nullable().optional(),
});

function campaignFields(formData: FormData) {
  return {
    name: String(formData.get("name") ?? ""),
    description: String(formData.get("description") ?? ""),
    channel: String(formData.get("channel") ?? "multi"),
    industry: String(formData.get("industry") ?? ""),
    service: String(formData.get("service") ?? ""),
    location: String(formData.get("location") ?? ""),
    target_audience: String(formData.get("target_audience") ?? ""),
  };
}

export async function createCampaign(_prev: Result, formData: FormData): Promise<Result> {
  const { member } = await requireGrowth();
  const parsed = campaignSchema.safeParse(campaignFields(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("ge_campaigns")
    .insert({ ...parsed.data, created_by: member.id });
  if (error) return { error: error.message };

  revalidatePath("/growth/campaigns");
  return { ok: true };
}

export async function updateCampaign(_prev: Result, formData: FormData): Promise<Result> {
  await requireGrowth();
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing campaign." };

  const parsed = campaignSchema.safeParse(campaignFields(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const admin = createAdminClient();
  const { error } = await admin.from("ge_campaigns").update(parsed.data).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath(`/growth/campaigns/${id}`);
  revalidatePath("/growth/campaigns");
  return { ok: true };
}

export async function setCampaignStatus(_prev: Result, formData: FormData): Promise<Result> {
  await requireGrowth();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !(CAMPAIGN_STATUSES as string[]).includes(status)) {
    return { error: "Invalid status." };
  }

  const admin = createAdminClient();
  const { error } = await admin.from("ge_campaigns").update({ status }).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath(`/growth/campaigns/${id}`);
  revalidatePath("/growth/campaigns");
  return { ok: true };
}

/** Prospects keep their history — deleting a campaign just detaches them. */
export async function deleteCampaign(_prev: Result, formData: FormData): Promise<Result> {
  const { member } = await requireGrowth();
  if (member.role !== "owner") return { error: "Only owners can delete campaigns." };
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing campaign." };

  const admin = createAdminClient();
  const { error } = await admin.from("ge_campaigns").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/growth/campaigns");
  return { ok: true };
}
