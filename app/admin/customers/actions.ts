"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAdminAction } from "@/lib/audit";
import { syncVoiceAgentKnowledge } from "@/lib/growth/voice-agent";

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

/**
 * Send (or resend) the login invite to every user on a business — a
 * set-password link to /auth/set-password. This is the "get them logged in"
 * button for onboarding: set the account up fully, then click this on the
 * call and the customer lands in a dashboard that already works.
 */
export async function sendLoginInvite(businessId: string) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id")
    .eq("business_id", businessId);
  if (!profiles || profiles.length === 0) {
    return { error: "No user on this account yet — create the customer with their email first." };
  }

  let sent = 0;
  let lastError: string | null = null;
  for (const p of profiles) {
    const { data: userRes } = await supabase.auth.admin.getUserById(p.id);
    const email = userRes.user?.email;
    if (!email) continue;
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${getSiteUrl()}/auth/set-password`,
    });
    if (error) lastError = error.message;
    else sent += 1;
  }

  if (sent === 0) {
    return { error: lastError ?? "Could not send the invite — no valid email on the account." };
  }

  await logAdminAction({
    actorId: admin.id,
    action: "customer.login_invite_sent",
    targetBusinessId: businessId,
    metadata: { sent },
  });

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
 * Provision a business's Voice Agent from the admin, AND pre-seed the
 * knowledge so the customer logs in to a fully-wired receptionist — status,
 * number and ElevenLabs link (AutomateIQ-controlled) PLUS the greeting /
 * services / hours / area / extra knowledge that would otherwise be blank
 * until the customer filled them in. So the whole demo flow is: provision
 * here → send the invite → they log in and everything already works.
 *
 * Knowledge fields are only written when provided, so re-saving status alone
 * never wipes content the customer has since edited themselves. After saving,
 * the complete current knowledge is pushed to the linked ElevenLabs agent
 * (best-effort) so the live receptionist matches the portal.
 */
export async function saveVoiceProvisioning(
  businessId: string,
  _prevState: { error?: string; ok?: boolean; notice?: string } | undefined,
  formData: FormData
) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  const status = String(formData.get("status") ?? "");
  if (!["provisioning", "live", "paused"].includes(status)) {
    return { error: "Pick a valid status." };
  }
  const phone = String(formData.get("phone_number") ?? "").trim().slice(0, 40) || null;
  // Tolerate a pasted browser URL or a "?branchId=…" query suffix — ElevenLabs'
  // agent page URL carries both, and the raw value 404s ("document_not_found")
  // if that tail is kept. Reduce to the bare agent id: drop any query/fragment
  // and, if it's a full URL, take the last path segment.
  let agentId: string | null = String(formData.get("elevenlabs_agent_id") ?? "")
    .trim()
    .split(/[?#\s]/)[0];
  if (agentId.includes("/")) {
    agentId = agentId.split("/").filter(Boolean).pop() ?? "";
  }
  agentId = agentId.slice(0, 120) || null;

  const row: Record<string, unknown> = {
    business_id: businessId,
    status,
    phone_number: phone,
    elevenlabs_agent_id: agentId,
    updated_at: new Date().toISOString(),
  };
  // Only overwrite a knowledge field when the admin actually typed something,
  // so a blank box never clears content the customer later edited themselves.
  const knowledgeFields: Record<string, string> = {
    greeting: String(formData.get("greeting") ?? "").trim().slice(0, 500),
    services: String(formData.get("services") ?? "").trim().slice(0, 2000),
    business_hours: String(formData.get("business_hours") ?? "").trim().slice(0, 500),
    service_area: String(formData.get("service_area") ?? "").trim().slice(0, 500),
    knowledge: String(formData.get("knowledge") ?? "").trim().slice(0, 4000),
  };
  for (const [k, v] of Object.entries(knowledgeFields)) {
    if (v) row[k] = v;
  }

  const { error } = await supabase
    .from("va_config")
    .upsert(row, { onConflict: "business_id" });
  if (error) {
    if (error.code === "42P01") {
      return { error: "Database update required — run supabase/manual_update_0019.sql (and 0020)." };
    }
    return { error: error.message };
  }

  // Push the COMPLETE current knowledge to the live ElevenLabs agent so the
  // receptionist matches the portal — best-effort, never fails the save. But
  // DO surface the outcome: a silent sync failure means the live agent is
  // stale, and the admin should know that on the spot (not mid-demo).
  let notice: string | undefined;
  try {
    const [{ data: cfg }, { data: biz }] = await Promise.all([
      supabase
        .from("va_config")
        .select("greeting, services, business_hours, service_area, knowledge, elevenlabs_agent_id")
        .eq("business_id", businessId)
        .maybeSingle(),
      supabase.from("businesses").select("name").eq("id", businessId).maybeSingle(),
    ]);
    if (cfg?.elevenlabs_agent_id) {
      const result = await syncVoiceAgentKnowledge(
        cfg.elevenlabs_agent_id,
        biz?.name ?? "",
        {
          greeting: cfg.greeting ?? "",
          services: cfg.services ?? "",
          businessHours: cfg.business_hours ?? "",
          serviceArea: cfg.service_area ?? "",
          knowledge: cfg.knowledge ?? "",
        }
      );
      if (!result.synced) {
        notice = `Saved to the portal — but the live ElevenLabs agent didn't update (${result.detail}). The receptionist will keep using its previous knowledge until this is resolved; check the agent ID and ELEVENLABS_API_KEY.`;
      }
    }
  } catch (err) {
    console.error("Voice provisioning: ElevenLabs sync skipped:", err);
    notice =
      "Saved to the portal — but pushing to the live ElevenLabs agent failed. Check the agent ID and ELEVENLABS_API_KEY; the live receptionist wasn't updated.";
  }

  await logAdminAction({
    actorId: admin.id,
    action: "voice.provision",
    targetBusinessId: businessId,
    metadata: { status, hasPhone: Boolean(phone), hasAgent: Boolean(agentId) },
  });

  revalidatePath(`/admin/customers/${businessId}`);
  return notice ? { ok: true, notice } : { ok: true };
}

/**
 * Pre-seed a business's AI Assistant knowledge + tone from the admin, so the
 * assistant is "online" and already knows the business the moment the customer
 * logs in — no blank-slate first run. The customer can still edit it in their
 * portal afterwards.
 */
export async function saveAssistantKnowledge(
  businessId: string,
  _prevState: { error?: string; ok?: boolean } | undefined,
  formData: FormData
) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  const knowledge = String(formData.get("knowledge") ?? "").trim().slice(0, 8000);
  const tone = String(formData.get("tone") ?? "").trim().slice(0, 120) || "friendly and professional";

  const { error } = await supabase.from("aa_assistants").upsert(
    {
      business_id: businessId,
      knowledge,
      tone,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "business_id" }
  );
  if (error) {
    if (error.code === "42P01") {
      return { error: "Database update required — run supabase/manual_update_0005.sql." };
    }
    return { error: error.message };
  }

  await logAdminAction({
    actorId: admin.id,
    action: "assistant.seed",
    targetBusinessId: businessId,
    metadata: { hasKnowledge: Boolean(knowledge) },
  });

  revalidatePath(`/admin/customers/${businessId}`);
  return { ok: true };
}

/**
 * Advance a customer's billing stage: 'inactive' → 'setup_paid' → 'active'.
 * Flipping to 'setup_paid' is what unlocks the €129 monthly payment link in
 * the customer's portal — so nobody starts a subscription before the setup
 * fee lands. Jude sees the €349 in Stripe, clicks "Mark setup fee paid", and
 * the monthly link appears for the customer. Purely a manual gate.
 */
export async function setBillingStage(
  businessId: string,
  stage: "inactive" | "setup_paid" | "active"
) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  const update: Record<string, unknown> = { subscription_status: stage };
  if (stage === "active") update.activated_at = new Date().toISOString();

  const { error } = await supabase.from("businesses").update(update).eq("id", businessId);
  if (error) {
    if (error.code === "42703" || error.code === "42P01") {
      return { error: "Billing columns missing — run supabase/migrations/0021_billing.sql." };
    }
    return { error: error.message };
  }

  await logAdminAction({
    actorId: admin.id,
    action: "billing.stage_set",
    targetBusinessId: businessId,
    metadata: { stage },
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
