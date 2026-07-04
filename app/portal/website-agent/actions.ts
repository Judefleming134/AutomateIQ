"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/require-session";
import { requireProductEnabled } from "@/lib/auth/require-product";
import { createClient } from "@/lib/supabase/server";

const pageSchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/,
      "Slug must be 3-50 characters: lowercase letters, numbers and dashes"
    ),
  headline: z.string().trim().max(120, "Keep the headline under 120 characters"),
  about: z.string().trim().max(2000, "Keep the about text under 2000 characters"),
  services: z.string().trim().max(1500),
  phone: z.string().trim().max(30).optional(),
  contactEmail: z
    .string()
    .trim()
    .email("Contact email must be valid")
    .optional()
    .or(z.literal("")),
  published: z.enum(["on"]).optional(),
});

export async function updateWebsitePage(
  _prevState: { error?: string; ok?: boolean } | undefined,
  formData: FormData
) {
  const { profile } = await requireSession();
  const businessId = profile.business_id!;

  const enabled = await requireProductEnabled(businessId, "website-agent");
  if (!enabled) {
    return { error: "Website Agent is not enabled for your account." };
  }

  const parsed = pageSchema.safeParse({
    slug: formData.get("slug"),
    headline: formData.get("headline") ?? "",
    about: formData.get("about") ?? "",
    services: formData.get("services") ?? "",
    phone: formData.get("phone") || undefined,
    contactEmail: formData.get("contactEmail") || "",
    published: formData.get("published") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { slug, headline, about, services, phone, contactEmail, published } =
    parsed.data;

  const serviceList = services
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 12);

  const supabase = await createClient();
  const { error } = await supabase.from("wa_pages").upsert(
    {
      business_id: businessId,
      slug,
      headline,
      about,
      services: serviceList,
      phone: phone || null,
      contact_email: contactEmail || null,
      published: published === "on",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "business_id" }
  );

  if (error) {
    if (error.code === "23505") {
      return { error: "That web address is already taken — pick another slug." };
    }
    if (error.code === "42P01") {
      return { error: "Database update required — run supabase/manual_update_0005.sql (see HANDOFF.md)." };
    }
    return { error: error.message };
  }

  revalidatePath("/portal/website-agent");
  revalidatePath(`/b/${slug}`);
  return { ok: true };
}
