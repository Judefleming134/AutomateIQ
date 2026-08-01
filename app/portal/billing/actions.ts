"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isMissingTableError, reportMissingTable } from "@/lib/db/errors";
import {
  isStripeConfigured,
  createStripeCustomer,
  createCheckoutSession,
  createBillingPortalSession,
} from "@/lib/billing/stripe";

type Result = { ok: true; url: string } | { ok: false; error: string };

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL || "https://automateiq.ie";
}

// ---- In-dashboard binding order form --------------------------------------

type OrderFormResult = { ok?: boolean; error?: string } | undefined;

const orderFormSchema = z.object({
  contact_name: z.string().trim().max(200),
  phone: z.string().trim().max(60),
  email: z.string().trim().max(200),
  business_hours: z.string().trim().max(400),
  agree: z.string().optional(), // "on" when the checkbox is ticked
  agreed_name: z.string().trim().max(200),
});

/**
 * Saves the customer's order form. Once it has been AGREED it is binding and
 * locked: the action refuses any further change (defence beyond the read-only
 * UI). To agree, the details must be filled AND the customer must tick the box
 * and type their full name. All RLS-scoped to the caller's own business.
 */
export async function saveOrderForm(
  _prev: OrderFormResult,
  formData: FormData
): Promise<OrderFormResult> {
  const { profile } = await requireSession();
  const businessId = profile.business_id!;
  const supabase = await createClient();

  const parsed = orderFormSchema.safeParse({
    contact_name: formData.get("contact_name") ?? "",
    phone: formData.get("phone") ?? "",
    email: formData.get("email") ?? "",
    business_hours: formData.get("business_hours") ?? "",
    agree: formData.get("agree") ?? undefined,
    agreed_name: formData.get("agreed_name") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const d = parsed.data;

  // Already agreed? It's binding — nothing further can change it here.
  const { data: existing, error: readErr } = await supabase
    .from("order_forms")
    .select("agreed")
    .eq("business_id", businessId)
    .maybeSingle();
  if (readErr && isMissingTableError(readErr)) {
    return { error: reportMissingTable("Your order form", "supabase/manual_update_0025.sql", readErr) };
  }
  if (existing?.agreed) {
    return { error: "This order has already been confirmed — it's locked." };
  }

  const wantsAgree = d.agree === "on";
  if (wantsAgree) {
    // Binding sign-off needs the details AND a typed name.
    if (!d.contact_name || !d.phone || !d.email) {
      return { error: "Fill in your name, phone and email before confirming." };
    }
    if (!d.agreed_name) {
      return { error: "Type your full name to confirm the order." };
    }
  }

  const row: Record<string, unknown> = {
    business_id: businessId,
    contact_name: d.contact_name,
    phone: d.phone,
    email: d.email,
    business_hours: d.business_hours,
    updated_at: new Date().toISOString(),
  };
  if (wantsAgree) {
    row.agreed = true;
    row.agreed_name = d.agreed_name;
    row.agreed_at = new Date().toISOString();
  }

  const { error } = await supabase
    .from("order_forms")
    .upsert(row, { onConflict: "business_id" });
  if (error) {
    return {
      error: isMissingTableError(error)
        ? reportMissingTable("Your order form", "supabase/manual_update_0025.sql", error)
        : error.message,
    };
  }

  revalidatePath("/portal/billing");
  return { ok: true };
}

/**
 * Begin activation: ensures the business has a Stripe customer, then opens a
 * Checkout Session (setup fee + first month). Returns the hosted Stripe URL
 * for the client to redirect to. All reads/writes are scoped to the caller's
 * own business_id (from their verified session), never a passed-in id.
 */
export async function startCheckout(): Promise<Result> {
  const { user, profile } = await requireSession();
  if (!isStripeConfigured()) {
    return { ok: false, error: "Billing isn't switched on yet — check back shortly." };
  }

  const admin = createAdminClient();
  const { data: business } = await admin
    .from("businesses")
    .select("id, name, stripe_customer_id, subscription_status")
    .eq("id", profile.business_id!)
    .single();
  if (!business) return { ok: false, error: "Business not found." };
  if (business.subscription_status === "active") {
    return { ok: false, error: "Your account is already active." };
  }

  try {
    let customerId = business.stripe_customer_id as string | null;
    if (!customerId) {
      customerId = await createStripeCustomer({
        email: user.email ?? "",
        name: business.name,
        businessId: business.id,
      });
      await admin
        .from("businesses")
        .update({ stripe_customer_id: customerId })
        .eq("id", business.id);
    }

    const { url } = await createCheckoutSession({
      customerId,
      businessId: business.id,
      successUrl: `${siteUrl()}/portal/billing?activated=1`,
      cancelUrl: `${siteUrl()}/portal/billing`,
    });
    return { ok: true, url };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Couldn't start checkout.",
    };
  }
}

/** Open the Stripe Billing Portal so an active customer can manage card/plan. */
export async function openBillingPortal(): Promise<Result> {
  const { profile } = await requireSession();
  if (!isStripeConfigured()) {
    return { ok: false, error: "Billing isn't switched on yet." };
  }
  const admin = createAdminClient();
  const { data: business } = await admin
    .from("businesses")
    .select("stripe_customer_id")
    .eq("id", profile.business_id!)
    .single();
  const customerId = business?.stripe_customer_id as string | null;
  if (!customerId) {
    return { ok: false, error: "No billing account yet — activate first." };
  }
  try {
    const { url } = await createBillingPortalSession({
      customerId,
      returnUrl: `${siteUrl()}/portal/billing`,
    });
    return { ok: true, url };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Couldn't open billing portal.",
    };
  }
}
