import "server-only";
import crypto from "node:crypto";

/**
 * Minimal Stripe client over the REST API (fetch + crypto) — deliberately no
 * `stripe` npm dependency, so nothing new can break the build and the whole
 * feature is inert until the env vars below are set.
 *
 * Required env to go live (add in Vercel):
 *   STRIPE_SECRET_KEY        sk_test_… then sk_live_…
 *   STRIPE_WEBHOOK_SECRET    whsec_…   (from the webhook endpoint in Stripe)
 *   STRIPE_MONTHLY_PRICE_ID  price_…   (recurring monthly price)
 *   STRIPE_SETUP_PRICE_ID    price_…   (one-time setup fee price) — optional
 *
 * Until STRIPE_SECRET_KEY is present, isStripeConfigured() is false and every
 * caller shows a friendly "not yet configured" state instead of erroring.
 */

const API = "https://api.stripe.com/v1";

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/** Stripe wants application/x-www-form-urlencoded with foo[bar]=baz nesting. */
function formEncode(params: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item && typeof item === "object") {
          out.push(...formEncode(item as Record<string, unknown>, `${key}[${i}]`));
        } else {
          out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`);
        }
      });
    } else if (typeof v === "object") {
      out.push(...formEncode(v as Record<string, unknown>, key));
    } else {
      out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    }
  }
  return out;
}

async function stripePost<T>(path: string, params: Record<string, unknown>): Promise<T> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Stripe is not configured.");
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formEncode(params).join("&"),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (json as { error?: { message?: string } })?.error?.message;
    throw new Error(msg ?? `Stripe error ${res.status}`);
  }
  return json as T;
}

/** Create (once) a Stripe customer for a business; caller stores the id. */
export async function createStripeCustomer(params: {
  email: string;
  name?: string | null;
  businessId: string;
}): Promise<string> {
  const customer = await stripePost<{ id: string }>("/customers", {
    email: params.email,
    name: params.name ?? undefined,
    metadata: { business_id: params.businessId },
  });
  return customer.id;
}

/**
 * A Checkout Session for setup fee + first month. `mode: subscription` with a
 * recurring price; the one-time setup price rides on the first invoice. Stripe
 * hosts the payment page (PCI-safe) and we just redirect to the returned URL.
 */
export async function createCheckoutSession(params: {
  customerId: string;
  businessId: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ url: string }> {
  const monthly = process.env.STRIPE_MONTHLY_PRICE_ID;
  const setup = process.env.STRIPE_SETUP_PRICE_ID;
  if (!monthly) throw new Error("STRIPE_MONTHLY_PRICE_ID is not set.");

  const lineItems: { price: string; quantity: number }[] = [
    { price: monthly, quantity: 1 },
  ];
  if (setup) lineItems.push({ price: setup, quantity: 1 });

  const session = await stripePost<{ url: string }>("/checkout/sessions", {
    mode: "subscription",
    customer: params.customerId,
    line_items: lineItems,
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    allow_promotion_codes: true,
    metadata: { business_id: params.businessId },
    subscription_data: { metadata: { business_id: params.businessId } },
  });
  return { url: session.url };
}

/**
 * A one-off Checkout Session for a variable amount — used by TradeIQ to let a
 * tradesperson's customer pay a specific invoice online. `mode: payment` with
 * an inline price (no pre-made Product/Price needed), so any invoice total
 * works. The document id rides in metadata for the webhook to mark it paid.
 */
export async function createInvoiceCheckoutSession(params: {
  amountCents: number;
  currency: string;
  label: string;
  customerEmail?: string | null;
  successUrl: string;
  cancelUrl: string;
  metadata: Record<string, string>;
}): Promise<{ url: string }> {
  const session = await stripePost<{ url: string }>("/checkout/sessions", {
    mode: "payment",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: (params.currency || "eur").toLowerCase(),
          unit_amount: params.amountCents,
          product_data: { name: params.label },
        },
      },
    ],
    customer_email: params.customerEmail || undefined,
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    metadata: params.metadata,
    payment_intent_data: { metadata: params.metadata },
  });
  return { url: session.url };
}

/** A Billing Portal session so an active customer can manage card/plan. */
export async function createBillingPortalSession(params: {
  customerId: string;
  returnUrl: string;
}): Promise<{ url: string }> {
  const session = await stripePost<{ url: string }>("/billing_portal/sessions", {
    customer: params.customerId,
    return_url: params.returnUrl,
  });
  return { url: session.url };
}

/**
 * Verify a Stripe webhook signature (the `stripe-signature` header:
 * `t=<ts>,v1=<hex hmac>`). HMAC-SHA256 of `${t}.${rawBody}` keyed with the
 * webhook secret (used as a UTF-8 string, unlike Svix's base64). 5-min replay
 * window. Returns the parsed event on success, or null on any failure.
 */
export function verifyStripeEvent(
  rawBody: string,
  sigHeader: string | null
): { type: string; id: string; data: { object: Record<string, unknown> } } | null {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !sigHeader) return null;

  const parts = Object.fromEntries(
    sigHeader.split(",").map((p) => p.split("=") as [string, string])
  );
  const t = parts["t"];
  const v1 = parts["v1"];
  if (!t || !v1) return null;

  const age = Math.abs(Date.now() / 1000 - Number(t));
  if (!Number.isFinite(age) || age > 300) return null;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${t}.${rawBody}`)
    .digest("hex");
  try {
    if (!crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(expected))) {
      return null;
    }
  } catch {
    return null;
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    return null;
  }
}
