"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/require-session";
import { requireProductEnabled } from "@/lib/auth/require-product";
import { createClient } from "@/lib/supabase/server";
import { isMissingTableError, reportMissingTable } from "@/lib/db/errors";
import { parseHours } from "@/lib/site-agent/hours";
import { parseAreas } from "@/lib/site-agent/page-content";

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
  hours: z.string().trim().max(600),
  areas: z.string().trim().max(1500),
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
  _prevState: { error?: string; ok?: boolean; notice?: string } | undefined,
  formData: FormData
) {
  const { profile } = await requireSession();
  const businessId = profile.business_id!;

  const enabled = await requireProductEnabled(businessId, "website-agent");
  if (!enabled) {
    return { error: "SiteIQ is not enabled for your account." };
  }

  const parsed = pageSchema.safeParse({
    slug: formData.get("slug"),
    headline: formData.get("headline") ?? "",
    about: formData.get("about") ?? "",
    services: formData.get("services") ?? "",
    hours: formData.get("hours") ?? "",
    areas: formData.get("areas") ?? "",
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

  // Opening hours refuse rather than guess: "9-5" could be 09:00–17:00 or
  // 09:00–05:00, and a page that quietly claims the wrong closing time sends
  // a customer to a locked door. The error names the line that caused it.
  const hoursResult = parseHours(parsed.data.hours);
  if (!hoursResult.ok) return { error: hoursResult.error };
  const areaList = parseAreas(parsed.data.areas);

  const supabase = await createClient();
  const base = {
    business_id: businessId,
    slug,
    headline,
    about,
    services: serviceList,
    phone: phone || null,
    contact_email: contactEmail || null,
    published: published === "on",
    updated_at: new Date().toISOString(),
  };

  let { error } = await supabase
    .from("wa_pages")
    .upsert({ ...base, hours: hoursResult.hours, areas: areaList }, { onConflict: "business_id" });

  // Migration 0040 not run yet. Saving the page is something Jude's customers
  // already do every day and it must not start failing because a new column
  // isn't there — so the save goes through without the two new fields rather
  // than the whole form breaking. PGRST204 is PostgREST's "column not found".
  if (error && (error.code === "PGRST204" || /column .*(hours|areas)/i.test(error.message))) {
    ({ error } = await supabase
      .from("wa_pages")
      .upsert(base, { onConflict: "business_id" }));
    if (!error) {
      // The customer is told what is and isn't live, not which SQL file to
      // run — that is Jude's job, and the console line is how he hears about
      // it. Same rule as reportMissingTable().
      console.error(
        "[wa_pages] hours/areas columns missing — run supabase/migrations/0040_siteiq_page.sql"
      );
      revalidatePath("/portal/website-agent");
      revalidatePath(`/b/${slug}`);
      return {
        ok: true,
        notice:
          "Saved. Opening hours and areas served aren't switched on for your account yet — we've been alerted and it's usually sorted the same working day. Everything else on your page is live.",
      };
    }
  }

  if (error) {
    if (error.code === "23505") {
      return { error: "That web address is already taken — pick another slug." };
    }
    if (isMissingTableError(error)) {
      return { error: reportMissingTable("SiteIQ", "supabase/manual_update_0005.sql", error) };
    }
    return { error: error.message };
  }

  revalidatePath("/portal/website-agent");
  revalidatePath(`/b/${slug}`);
  return { ok: true };
}
