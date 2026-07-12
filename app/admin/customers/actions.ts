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
  const productKeys = formData
    .getAll("products")
    .map(String)
    .filter(Boolean);

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

  // Assign the selected products in the same step — onboarding a customer
  // is ONE form, not create-then-go-assign-things.
  if (productKeys.length > 0) {
    const { data: products } = await supabase
      .from("products")
      .select("id")
      .in("key", productKeys);
    if (products && products.length > 0) {
      await supabase.from("business_products").insert(
        products.map((p) => ({
          business_id: business.id,
          product_id: p.id,
        }))
      );
    }
  }

  await logAdminAction({
    actorId: admin.id,
    action: "customer.create",
    targetBusinessId: business.id,
    metadata: { businessName, email, products: productKeys },
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

/**
 * Provision a business's Voice Agent from the admin — the fields AutomateIQ
 * controls (never the customer): live/paused status, the phone number shown
 * in their portal, and the ElevenLabs agent id that portal knowledge edits
 * sync to. Upserts only these columns, so the customer's own greeting /
 * services / knowledge are left untouched. Lets Jude flip Castleknock live
 * without touching SQL.
 */
export async function saveVoiceProvisioning(
  businessId: string,
  _prevState: { error?: string; ok?: boolean } | undefined,
  formData: FormData
) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  const status = String(formData.get("status") ?? "");
  if (!["provisioning", "live", "paused"].includes(status)) {
    return { error: "Pick a valid status." };
  }
  const phone = String(formData.get("phone_number") ?? "").trim().slice(0, 40) || null;
  const agentId =
    String(formData.get("elevenlabs_agent_id") ?? "").trim().slice(0, 120) || null;

  const { error } = await supabase.from("va_config").upsert(
    {
      business_id: businessId,
      status,
      phone_number: phone,
      elevenlabs_agent_id: agentId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "business_id" }
  );
  if (error) {
    if (error.code === "42P01") {
      return { error: "Database update required — run supabase/manual_update_0019.sql (and 0020)." };
    }
    return { error: error.message };
  }

  await logAdminAction({
    actorId: admin.id,
    action: "voice.provision",
    targetBusinessId: businessId,
    metadata: { status, hasPhone: Boolean(phone), hasAgent: Boolean(agentId) },
  });

  revalidatePath(`/admin/customers/${businessId}`);
  return { ok: true };
}

const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;

export async function uploadDocument(
  businessId: string,
  _prevState: { error?: string; ok?: boolean } | undefined,
  formData: FormData
) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  const file = formData.get("file");
  const label = String(formData.get("label") ?? "").trim();

  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a file to upload." };
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    return { error: "File is too large — 15MB max." };
  }

  const safeName = file.name.replace(/[^\w.\-]+/g, "_").slice(0, 80);
  const storagePath = `${businessId}/${crypto.randomUUID()}-${safeName}`;

  const { error: storageError } = await supabase.storage
    .from("documents")
    .upload(storagePath, file, {
      contentType: file.type || "application/octet-stream",
    });

  if (storageError) {
    return { error: `Upload failed: ${storageError.message}` };
  }

  const { error: rowError } = await supabase.from("documents").insert({
    business_id: businessId,
    name: label || file.name,
    storage_path: storagePath,
    file_size: file.size,
    content_type: file.type || null,
  });

  if (rowError) {
    // Don't leave an orphaned file the index doesn't know about.
    await supabase.storage.from("documents").remove([storagePath]);
    if (rowError.code === "42P01") {
      return { error: "Database update required — run supabase/manual_update_0006.sql." };
    }
    return { error: rowError.message };
  }

  await logAdminAction({
    actorId: admin.id,
    action: "document.upload",
    targetBusinessId: businessId,
    metadata: { name: label || file.name, size: file.size },
  });

  revalidatePath(`/admin/customers/${businessId}`);
  return { ok: true };
}

export async function deleteDocument(documentId: string) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  const { data: doc } = await supabase
    .from("documents")
    .select("business_id, name, storage_path")
    .eq("id", documentId)
    .maybeSingle();

  if (!doc) return { error: "Document not found." };

  const { error } = await supabase.from("documents").delete().eq("id", documentId);
  if (error) return { error: error.message };

  await supabase.storage.from("documents").remove([doc.storage_path]);

  await logAdminAction({
    actorId: admin.id,
    action: "document.delete",
    targetBusinessId: doc.business_id,
    metadata: { name: doc.name },
  });

  revalidatePath(`/admin/customers/${doc.business_id}`);
  return { ok: true };
}
