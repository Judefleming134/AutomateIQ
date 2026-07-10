"use server";

import { requireSession } from "@/lib/auth/require-session";
import { createAdminClient } from "@/lib/supabase/admin";
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
