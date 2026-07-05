"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/require-session";
import { requireProductEnabled } from "@/lib/auth/require-product";
import { createClient } from "@/lib/supabase/server";

const settingsSchema = z.object({
  enabled: z.boolean(),
  subject: z.string().trim().min(1, "Subject is required").max(200),
  replyTemplate: z
    .string()
    .trim()
    .min(10, "The reply is a little short")
    .max(4000, "Keep the reply under 4000 characters"),
});

export async function updateSpeedToLeadSettings(
  _prevState: { error?: string; ok?: boolean } | undefined,
  formData: FormData
) {
  const { profile } = await requireSession();
  const businessId = profile.business_id!;

  const enabled = await requireProductEnabled(businessId, "speed-to-lead-agent");
  if (!enabled) {
    return { error: "Speed-to-Lead Agent is not enabled for your account." };
  }

  const parsed = settingsSchema.safeParse({
    enabled: formData.get("enabled") === "on",
    subject: formData.get("subject") ?? "",
    replyTemplate: formData.get("replyTemplate") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("stl_settings").upsert(
    {
      business_id: businessId,
      enabled: parsed.data.enabled,
      subject: parsed.data.subject,
      reply_template: parsed.data.replyTemplate,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "business_id" }
  );

  if (error) {
    if (error.code === "42P01") {
      return { error: "Database update required — run supabase/manual_update_0007.sql." };
    }
    return { error: error.message };
  }

  revalidatePath("/portal/speed-to-lead-agent");
  return { ok: true };
}
