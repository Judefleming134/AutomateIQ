"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";
import { reviewLinkStatus } from "@/lib/review-agent/review-hosts";

const settingsSchema = z.object({
  businessName: z.string().trim().min(1, "Business name is required"),
  // NOT z.string().url(). That refused "g.page/r/xyz/review" — which is how
  // an owner actually copies a Google review link, and which the redirect
  // path handles fine — while happily accepting https://example.com. The real
  // check is reviewLinkStatus below, using the same parser the redirect uses.
  googleReviewLink: z.string().trim().max(2000).optional(),
  logoUrl: z.string().trim().url("Enter a valid URL").or(z.literal("")).optional(),
  emailSignature: z.string().trim().optional(),
});

export async function updateBusinessSettings(
  _prevState: { error?: string; ok?: boolean; notice?: string } | undefined,
  formData: FormData
): Promise<{ error?: string; ok?: boolean; notice?: string }> {
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

  // Judge the link with the SAME parser that will later redirect a customer,
  // so what saves and what works can't disagree. An unusable link is rejected;
  // an unrecognised-but-valid host is saved with a warning, because refusing
  // it would break a legitimate customer whose platform isn't on our list.
  const link = parsed.data.googleReviewLink ?? "";
  let storedLink: string | null = null;
  let notice: string | null = null;
  if (link) {
    const status = reviewLinkStatus(link);
    if (!status.ok) return { error: status.message };
    // Store the NORMALISED absolute URL, so a schemeless paste is resolved
    // once here rather than re-guessed on every redirect.
    storedLink = status.url.toString();
    notice = status.message;
  }

  // RLS (is_active_tenant_member) scopes this update to the caller's own
  // business — there's no need to double-check business_id here, an
  // attempt to update someone else's row would simply match zero rows.
  const { error } = await supabase
    .from("businesses")
    .update({
      name: parsed.data.businessName,
      google_review_link: storedLink,
      logo_url: parsed.data.logoUrl || null,
      email_signature: parsed.data.emailSignature || null,
    })
    .eq("id", profile.business_id!);

  if (error) return { error: error.message };

  revalidatePath("/portal/review-agent/settings");
  // Saved, but say what their customers will actually experience.
  return notice ? { ok: true, notice } : { ok: true };
}
