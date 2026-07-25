import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyStripeEvent } from "@/lib/billing/stripe";

/**
 * Stripe webhook → account activation. Payment confirmed here (never trusted
 * from the browser) flips a business to active and enables the products they
 * paid for. Signature-verified; idempotent via bl_billing_events so a retried
 * event never double-processes.
 *
 * Setup: Stripe dashboard → Developers → Webhooks → add
 *   https://automateiq.ie/api/webhooks/stripe
 * events: checkout.session.completed, customer.subscription.updated,
 * customer.subscription.deleted, invoice.payment_failed. Put the signing
 * secret in STRIPE_WEBHOOK_SECRET.
 */

// Products unlocked on activation — the same rows an admin toggle creates.
const ACTIVATION_PRODUCT_KEYS = ["ai-assistant", "voice-agent"];

async function enableProducts(
  admin: ReturnType<typeof createAdminClient>,
  businessId: string
) {
  const { data: products } = await admin
    .from("products")
    .select("id, key")
    .in("key", ACTIVATION_PRODUCT_KEYS);
  for (const p of products ?? []) {
    const { data: existing } = await admin
      .from("business_products")
      .select("business_id")
      .eq("business_id", businessId)
      .eq("product_id", p.id)
      .maybeSingle();
    if (!existing) {
      await admin
        .from("business_products")
        .insert({ business_id: businessId, product_id: p.id });
    }
  }
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const event = verifyStripeEvent(rawBody, request.headers.get("stripe-signature"));
  if (!event) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const admin = createAdminClient();
  const obj = event.data.object as Record<string, unknown>;
  const metadata = (obj.metadata ?? {}) as Record<string, unknown>;
  const businessId =
    (typeof metadata.business_id === "string" && metadata.business_id) || null;

  // Idempotency: record the event first. A duplicate (retry) hits the unique
  // index on stripe_event_id and we skip re-processing.
  const { error: dupeError } = await admin.from("bl_billing_events").insert({
    stripe_event_id: event.id,
    type: event.type,
    business_id: businessId,
  });
  if (dupeError) {
    // 23505 = already processed. Anything else: acknowledge so Stripe doesn't
    // hammer retries, but log it.
    if (dupeError.code !== "23505") {
      console.error("billing event log failed:", dupeError.message);
    }
    return NextResponse.json({ ok: true, duplicate: dupeError.code === "23505" });
  }

  // TradeOS invoice payment — a one-off checkout with a tradeos_document_id in
  // metadata (no business_id). Kept separate from the billing logic below so it
  // can never affect account activation. Marks the invoice paid — the only
  // trusted source of "paid", never the browser redirect.
  const tradeosDocId =
    (typeof metadata.tradeos_document_id === "string" && metadata.tradeos_document_id) || null;

  try {
    if (event.type === "checkout.session.completed" && tradeosDocId) {
      await admin
        .from("trades_documents")
        .update({ status: "paid", paid_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", tradeosDocId)
        .eq("kind", "invoice");
      // Network sync: a bill this document created in a connected account's
      // Finance flips to paid with it.
      await admin
        .from("trades_expenses")
        .update({ status: "paid", paid_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("linked_document_id", tradeosDocId);
    } else if (event.type === "checkout.session.completed") {
      if (businessId) {
        await admin
          .from("businesses")
          .update({
            subscription_status: "active",
            activated_at: new Date().toISOString(),
            stripe_customer_id:
              typeof obj.customer === "string" ? obj.customer : undefined,
            stripe_subscription_id:
              typeof obj.subscription === "string" ? obj.subscription : undefined,
          })
          .eq("id", businessId);
        await enableProducts(admin, businessId);
      }
    } else if (event.type === "customer.subscription.updated") {
      // active | past_due | canceled | unpaid | trialing …
      const status = typeof obj.status === "string" ? obj.status : "active";
      const subId = typeof obj.id === "string" ? obj.id : null;
      if (subId) {
        await admin
          .from("businesses")
          .update({ subscription_status: status })
          .eq("stripe_subscription_id", subId);
      }
    } else if (event.type === "customer.subscription.deleted") {
      const subId = typeof obj.id === "string" ? obj.id : null;
      if (subId) {
        await admin
          .from("businesses")
          .update({ subscription_status: "canceled" })
          .eq("stripe_subscription_id", subId);
      }
    } else if (event.type === "invoice.payment_failed") {
      const customer = typeof obj.customer === "string" ? obj.customer : null;
      if (customer) {
        await admin
          .from("businesses")
          .update({ subscription_status: "past_due" })
          .eq("stripe_customer_id", customer);
      }
    }
  } catch (err) {
    console.error("Stripe webhook processing error:", err);
    // Every branch above is an idempotent update (set-status, guarded
    // inserts), so redelivery is safe. Release the idempotency record and
    // return 500 so Stripe retries — otherwise a transient failure here
    // permanently strands a paid invoice/activation behind the dupe check.
    await admin.from("bl_billing_events").delete().eq("stripe_event_id", event.id);
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
