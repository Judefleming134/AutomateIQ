"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";

const settingsSchema = z.object({
  businessName: z.string().trim().min(1, "Business name is required"),
  googleReviewLink: z
    .string()
    .trim()
    .url("Enter a valid URL")
    .or(z.literal(""))
    .optional(),
  logoUrl: z.string().trim().url("Enter a valid URL").or(z.literal("")).optional(),
  emailSignature: z.string().trim().optional(),
});

export async function updateBusinessSettings(
  _prevState: { error?: string; ok?: boolean } | undefined,
  formData: FormData
) {
  const { profile } = await requireSession();
  const supabase = await createClient();

  const parsed = settingsSchema.safeParse({
    businessName: formData.get("businessName"),
    googleReviewLink: formData.get("googleReviewLink"),
    logoUrl: formData.get("logoUrl"),
    emailSignature: formData.get("emailSignature"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  // RLS (is_active_tenant_member) scopes this update to the caller's own
  // business — there's no need to double-check business_id here, an
  // attempt to update someone else's row would simply match zero rows.
  const { error } = await supabase
    .from("businesses")
    .update({
      name: parsed.data.businessName,
      google_review_link: parsed.data.googleReviewLink || null,
      logo_url: parsed.data.logoUrl || null,
      email_signature: parsed.data.emailSignature || null,
    })
    .eq("id", profile.business_id!);

  if (error) return { error: error.message };

  revalidatePath("/portal/review-agent/settings");
  return { ok: true };
}
