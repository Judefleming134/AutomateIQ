"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAdminAction } from "@/lib/audit";
import { isMissingTableError } from "@/lib/db/errors";

type Result = { ok?: boolean; error?: string } | undefined;

const NEEDS_MIGRATION =
  "Database update required — run supabase/manual_update_0012.sql in the Supabase SQL Editor, then try again.";

const DEV_STATUSES = ["planned", "in_development", "available"] as const;
const MODULE_STATUSES = ["coming_soon", "provisioning", "active", "disabled"] as const;

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

const createSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  description: z.string().trim().max(500).optional().or(z.literal("")),
  icon: z.string().trim().max(40).optional().or(z.literal("")),
  devStatus: z.enum(DEV_STATUSES),
  sortOrder: z.coerce.number().int().min(0).max(100000).default(100),
});

/** Create a new (custom) business system in the catalogue. */
export async function createSystem(_prev: Result, formData: FormData): Promise<Result> {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  const parsed = createSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || "",
    icon: formData.get("icon") || "",
    devStatus: formData.get("devStatus") || "planned",
    sortOrder: formData.get("sortOrder") || 100,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;

  let key = slugify(d.name) || "system";
  const { data: existing } = await supabase
    .from("bsys_systems")
    .select("id")
    .eq("key", key)
    .maybeSingle();
  if (existing) key = `${key}-${Math.random().toString(36).slice(2, 6)}`;

  const { error } = await supabase.from("bsys_systems").insert({
    key,
    name: d.name,
    description: d.description || "",
    icon: d.icon || "layers",
    dev_status: d.devStatus,
    sort_order: d.sortOrder,
    is_custom: true,
  });
  if (error) return { error: isMissingTableError(error) ? NEEDS_MIGRATION : error.message };

  await logAdminAction({ actorId: admin.id, action: "system.create", metadata: { key, name: d.name } });
  revalidatePath("/admin/systems");
  return { ok: true };
}

/** Update a system's development status. */
export async function setSystemDevStatus(id: string, devStatus: string): Promise<Result> {
  const admin = await requireAdmin();
  if (!(DEV_STATUSES as readonly string[]).includes(devStatus)) {
    return { error: "Invalid status." };
  }
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("bsys_systems")
    .update({ dev_status: devStatus })
    .eq("id", id);
  if (error) return { error: error.message };

  await logAdminAction({ actorId: admin.id, action: "system.dev_status", metadata: { id, devStatus } });
  revalidatePath("/admin/systems");
  return { ok: true };
}

/** Delete a custom system (built-in catalogue rows are protected). */
export async function deleteSystem(id: string): Promise<Result> {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  const { data: sys } = await supabase
    .from("bsys_systems")
    .select("is_custom, name")
    .eq("id", id)
    .maybeSingle();
  if (!sys) return { error: "System not found." };
  if (!sys.is_custom) {
    return { error: "Built-in systems can't be deleted — set their status instead." };
  }
  const { error } = await supabase.from("bsys_systems").delete().eq("id", id);
  if (error) return { error: error.message };

  await logAdminAction({ actorId: admin.id, action: "system.delete", metadata: { id, name: sys.name } });
  revalidatePath("/admin/systems");
  return { ok: true };
}

const assignSchema = z.object({
  businessId: z.string().uuid("Pick an organisation"),
  systemId: z.string().uuid("Pick a system"),
  moduleStatus: z.enum(MODULE_STATUSES),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});

/** Assign (or re-assign) a system to an organisation with a module status. */
export async function assignSystem(_prev: Result, formData: FormData): Promise<Result> {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  const parsed = assignSchema.safeParse({
    businessId: formData.get("businessId"),
    systemId: formData.get("systemId"),
    moduleStatus: formData.get("moduleStatus") || "coming_soon",
    notes: formData.get("notes") || "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;

  const { error } = await supabase.from("bsys_assignments").upsert(
    {
      business_id: d.businessId,
      system_id: d.systemId,
      module_status: d.moduleStatus,
      notes: d.notes || "",
    },
    { onConflict: "business_id,system_id" }
  );
  if (error) return { error: isMissingTableError(error) ? NEEDS_MIGRATION : error.message };

  await logAdminAction({
    actorId: admin.id,
    action: "system.assign",
    targetBusinessId: d.businessId,
    metadata: { systemId: d.systemId, moduleStatus: d.moduleStatus },
  });
  revalidatePath("/admin/systems");
  return { ok: true };
}

/** Change the module status of an existing assignment (enable/disable). */
export async function setAssignmentStatus(
  businessId: string,
  systemId: string,
  moduleStatus: string
): Promise<Result> {
  const admin = await requireAdmin();
  if (!(MODULE_STATUSES as readonly string[]).includes(moduleStatus)) {
    return { error: "Invalid status." };
  }
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("bsys_assignments")
    .update({ module_status: moduleStatus })
    .eq("business_id", businessId)
    .eq("system_id", systemId);
  if (error) return { error: error.message };

  await logAdminAction({
    actorId: admin.id,
    action: "system.assignment_status",
    targetBusinessId: businessId,
    metadata: { systemId, moduleStatus },
  });
  revalidatePath("/admin/systems");
  return { ok: true };
}

/** Remove a system from an organisation. */
export async function removeAssignment(businessId: string, systemId: string): Promise<Result> {
  const admin = await requireAdmin();
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("bsys_assignments")
    .delete()
    .eq("business_id", businessId)
    .eq("system_id", systemId);
  if (error) return { error: error.message };

  await logAdminAction({
    actorId: admin.id,
    action: "system.unassign",
    targetBusinessId: businessId,
    metadata: { systemId },
  });
  revalidatePath("/admin/systems");
  return { ok: true };
}
