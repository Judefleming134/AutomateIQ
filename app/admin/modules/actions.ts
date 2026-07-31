"use server";

import { z } from "zod";
import { assignProducts } from "@/lib/admin/entitlements";
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

  // A module is only reachable if the CustomIQ product is enabled
  // for that business — enable it automatically so "create module" is one
  // step, not two.
  //
  // CHECKED now. Both the lookup miss (`if (product)` silently skipped) and
  // the upsert error were dropped, so the module could be created while the
  // entitlement that makes it reachable was not — leaving a module nobody can
  // open, and an admin who was told it worked. The comment above already
  // states the consequence; the code just wasn't acting on it.
  const entitlements = await assignProducts(supabase, businessId, ["custom-solutions"]);

  await logAdminAction({
    actorId: admin.id,
    action: "module.create",
    targetBusinessId: businessId,
    metadata: {
      name,
      ...(entitlements.assigned.length === 0
        ? { customSolutionsEnabled: false, reason: entitlements.error ?? "product key not found" }
        : {}),
    },
  });

  revalidatePath("/admin/modules");
  // Say so if the module is not reachable yet, rather than reporting a clean
  // success for a module the customer cannot open.
  return entitlements.assigned.length === 0
    ? {
        ok: true,
        notice:
          "Module created, but Custom Solutions could not be enabled for this customer, so they can't open it yet. Enable it on their Products tab.",
      }
    : { ok: true };
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
