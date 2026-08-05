"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/require-session";
import { requireProductEnabled } from "@/lib/auth/require-product";
import { createClient } from "@/lib/supabase/server";
import { isMissingTableError, reportMissingTable } from "@/lib/db/errors";
import { centsFromInput } from "@/lib/assetiq/due";

async function ctx() {
  const { profile } = await requireSession();
  const businessId = profile.business_id!;
  // Re-checked here and not only in the layout: a layout is the UX gate, a
  // direct POST does not go through it.
  const enabled = await requireProductEnabled(businessId, "assetiq");
  const supabase = await createClient();
  return { businessId, enabled, supabase };
}

const CATEGORIES = ["vehicle", "plant", "tool", "equipment", "it", "other"] as const;
const STATUSES = ["in_service", "in_repair", "retired"] as const;

/** Matches the table's own check constraints, so the DB can never be the
 *  first thing to reject a form the UI was happy with. */
const AssetInput = z.object({
  name: z.string().trim().min(1, "Give the asset a name.").max(160),
  category: z.enum(CATEGORIES),
  identifier: z.string().trim().max(120).optional(),
  assigned_to: z.string().trim().max(160).optional(),
  location: z.string().trim().max(160).optional(),
  purchase_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  purchase_cost: z.string().trim().max(20).optional(),
  next_due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  next_due_label: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(2000).optional(),
});

type Result = { ok?: boolean; error?: string; notice?: string } | undefined;

/** Empty string → null, so a blank optional field is absent rather than "". */
const orNull = (v: string | undefined) => {
  const t = (v ?? "").trim();
  return t.length > 0 ? t : null;
};

export async function addAsset(_prev: Result, formData: FormData): Promise<Result> {
  const { businessId, enabled, supabase } = await ctx();
  if (!enabled) return { error: "AssetIQ isn't enabled on this account." };

  const parsed = AssetInput.safeParse({
    name: String(formData.get("name") ?? ""),
    category: String(formData.get("category") ?? "other"),
    identifier: String(formData.get("identifier") ?? ""),
    assigned_to: String(formData.get("assigned_to") ?? ""),
    location: String(formData.get("location") ?? ""),
    purchase_date: String(formData.get("purchase_date") ?? ""),
    purchase_cost: String(formData.get("purchase_cost") ?? ""),
    next_due_date: String(formData.get("next_due_date") ?? ""),
    next_due_label: String(formData.get("next_due_label") ?? ""),
    notes: String(formData.get("notes") ?? ""),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the details and try again." };
  }
  const d = parsed.data;

  // A cost that does not parse is REFUSED rather than stored as 0. Silently
  // recording that a €4,000 machine cost nothing is worse than making someone
  // retype it, because the total is what the whole page is for.
  const rawCost = (d.purchase_cost ?? "").trim();
  const cost = rawCost ? centsFromInput(rawCost) : null;
  if (rawCost && cost === null) {
    return { error: `"${rawCost}" isn't an amount — try 4200 or 4,200.50.` };
  }

  const { error } = await supabase.from("ast_assets").insert({
    business_id: businessId,
    name: d.name,
    category: d.category,
    identifier: orNull(d.identifier),
    assigned_to: orNull(d.assigned_to),
    location: orNull(d.location),
    purchase_date: orNull(d.purchase_date),
    purchase_cost_cents: cost,
    next_due_date: orNull(d.next_due_date),
    next_due_label: orNull(d.next_due_label),
    notes: orNull(d.notes),
  });
  if (error) {
    if (isMissingTableError(error)) {
      return { error: reportMissingTable("AssetIQ", "supabase/migrations/0045_assetiq.sql", error) };
    }
    return { error: "Couldn't save that asset. Try again." };
  }

  revalidatePath("/portal/assetiq");
  return { ok: true, notice: `${d.name} added.` };
}

const StatusInput = z.object({
  id: z.string().uuid(),
  status: z.enum(STATUSES),
});

export async function setAssetStatus(
  id: string,
  status: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { enabled, supabase } = await ctx();
  if (!enabled) return { ok: false, error: "AssetIQ isn't enabled on this account." };

  const parsed = StatusInput.safeParse({ id, status });
  if (!parsed.success) return { ok: false, error: "Unknown status." };

  // No business_id filter needed for correctness — RLS scopes the update to
  // the caller's own rows — but it is not omitted for style either: the
  // policy is the boundary and this is not relying on the id being unguessable.
  const { error } = await supabase
    .from("ast_assets")
    .update({ status: parsed.data.status, updated_at: new Date().toISOString() })
    .eq("id", parsed.data.id);
  if (error) return { ok: false, error: "Couldn't change that. Try again." };

  revalidatePath("/portal/assetiq");
  return { ok: true };
}

const DueInput = z.object({
  id: z.string().uuid(),
  next_due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  next_due_label: z.string().trim().max(80).nullable(),
});

/**
 * Books the NEXT thing due on an asset — which is what you do the moment the
 * last one is done. Clearing the date is allowed and is not a delete: an asset
 * with nothing due is a normal state, not a missing record.
 */
export async function setAssetDue(
  id: string,
  nextDueDate: string | null,
  nextDueLabel: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { enabled, supabase } = await ctx();
  if (!enabled) return { ok: false, error: "AssetIQ isn't enabled on this account." };

  const parsed = DueInput.safeParse({
    id,
    next_due_date: nextDueDate && nextDueDate.length > 0 ? nextDueDate : null,
    next_due_label: nextDueLabel && nextDueLabel.trim().length > 0 ? nextDueLabel.trim() : null,
  });
  if (!parsed.success) return { ok: false, error: "That date didn't look right." };

  const { error } = await supabase
    .from("ast_assets")
    .update({
      next_due_date: parsed.data.next_due_date,
      next_due_label: parsed.data.next_due_label,
      updated_at: new Date().toISOString(),
    })
    .eq("id", parsed.data.id);
  if (error) return { ok: false, error: "Couldn't update that. Try again." };

  revalidatePath("/portal/assetiq");
  return { ok: true };
}
