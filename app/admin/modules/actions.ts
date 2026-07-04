"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAdminAction } from "@/lib/audit";

const createModuleSchema = z.object({
  businessId: z.string().uuid("Pick a business"),
  name: z.string().trim().min(1, "Module name is required"),
  description: z.string().trim().optional(),
  content: z.string().trim().optional(),
  embedUrl: z
    .string()
    .trim()
    .url("Embed URL must be a valid URL")
    .optional()
    .or(z.literal("")),
});

function slugify(name: string) {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  // Random suffix keeps slugs unique across businesses without needing a
  // uniqueness round-trip.
  return `${base || "module"}-${Math.random().toString(36).slice(2, 6)}`;
}

export async function createModule(
  _prevState: { error?: string; ok?: boolean } | undefined,
  formData: FormData
) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  const parsed = createModuleSchema.safeParse({
    businessId: formData.get("businessId"),
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    content: formData.get("content") || undefined,
    embedUrl: formData.get("embedUrl") || "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { businessId, name, description, content, embedUrl } = parsed.data;

  const { error } = await supabase.from("custom_modules").insert({
    business_id: businessId,
    name,
    description: description || null,
    route_slug: slugify(name),
    config: { content: content || "", embed_url: embedUrl || "" },
  });

  if (error) return { error: error.message };

  // A module is only reachable if the Custom Solutions product is enabled
  // for that business — enable it automatically so "create module" is one
  // step, not two.
  const { data: product } = await supabase
    .from("products")
    .select("id")
    .eq("key", "custom-solutions")
    .single();
  if (product) {
    await supabase
      .from("business_products")
      .upsert(
        { business_id: businessId, product_id: product.id },
        { onConflict: "business_id,product_id" }
      );
  }

  await logAdminAction({
    actorId: admin.id,
    action: "module.create",
    targetBusinessId: businessId,
    metadata: { name },
  });

  revalidatePath("/admin/modules");
  return { ok: true };
}

export async function deleteModule(moduleId: string) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  const { data: mod } = await supabase
    .from("custom_modules")
    .select("business_id, name")
    .eq("id", moduleId)
    .maybeSingle();

  const { error } = await supabase
    .from("custom_modules")
    .delete()
    .eq("id", moduleId);

  if (error) return { error: error.message };

  await logAdminAction({
    actorId: admin.id,
    action: "module.delete",
    targetBusinessId: mod?.business_id,
    metadata: { name: mod?.name },
  });

  revalidatePath("/admin/modules");
  return { ok: true };
}
