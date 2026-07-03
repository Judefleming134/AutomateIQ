"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAdminAction } from "@/lib/audit";

const createCustomerSchema = z.object({
  businessName: z.string().trim().min(1, "Business name is required"),
  email: z.string().trim().email("A valid email is required"),
});

function getSiteUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL || "https://automateiq.ie";
}

export async function createCustomer(
  _prevState: { error?: string; ok?: boolean } | undefined,
  formData: FormData
) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  const parsed = createCustomerSchema.safeParse({
    businessName: formData.get("businessName"),
    email: formData.get("email"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { businessName, email } = parsed.data;

  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .insert({ name: businessName })
    .select("id")
    .single();

  if (businessError) {
    return { error: businessError.message };
  }

  const { error: inviteError } = await supabase.auth.admin.inviteUserByEmail(
    email,
    {
      data: { role: "customer", business_id: business.id },
      // Without this the link falls back to the Supabase project's Site URL
      // (the marketing homepage), where the session tokens are silently lost.
      redirectTo: `${getSiteUrl()}/auth/set-password`,
    }
  );

  if (inviteError) {
    // Best-effort cleanup: don't leave an orphaned business with no user.
    await supabase.from("businesses").delete().eq("id", business.id);
    return { error: inviteError.message };
  }

  await logAdminAction({
    actorId: admin.id,
    action: "customer.create",
    targetBusinessId: business.id,
    metadata: { businessName, email },
  });

  revalidatePath("/admin/customers");
  return { ok: true };
}

export async function setBusinessStatus(
  businessId: string,
  status: "active" | "suspended"
) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("businesses")
    .update({ status })
    .eq("id", businessId);

  if (error) return { error: error.message };

  await logAdminAction({
    actorId: admin.id,
    action: status === "suspended" ? "customer.suspend" : "customer.unsuspend",
    targetBusinessId: businessId,
  });

  revalidatePath("/admin/customers");
  revalidatePath(`/admin/customers/${businessId}`);
  return { ok: true };
}

export async function softDeleteBusiness(businessId: string) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("businesses")
    .update({ deleted_at: new Date().toISOString(), status: "suspended" })
    .eq("id", businessId);

  if (error) return { error: error.message };

  await logAdminAction({
    actorId: admin.id,
    action: "customer.delete",
    targetBusinessId: businessId,
  });

  revalidatePath("/admin/customers");
  return { ok: true };
}

export async function resetUserPassword(userId: string, email: string) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  // The customer gets a reset email directly — the admin never sees or
  // transmits a live credential.
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${getSiteUrl()}/auth/set-password`,
  });

  if (error) return { error: error.message };

  await logAdminAction({
    actorId: admin.id,
    action: "customer.password_reset_sent",
    metadata: { userId, email },
  });

  return { ok: true };
}

export async function setProductEnabled(
  businessId: string,
  productId: string,
  enabled: boolean
) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  if (enabled) {
    const { error } = await supabase
      .from("business_products")
      .upsert({ business_id: businessId, product_id: productId });
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase
      .from("business_products")
      .delete()
      .eq("business_id", businessId)
      .eq("product_id", productId);
    if (error) return { error: error.message };
  }

  await logAdminAction({
    actorId: admin.id,
    action: enabled ? "product.assign" : "product.remove",
    targetBusinessId: businessId,
    metadata: { productId },
  });

  revalidatePath(`/admin/customers/${businessId}`);
  return { ok: true };
}
