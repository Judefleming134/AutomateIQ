/**
 * Stripe Payment Links for the founding-rate voice-agent offer. These are
 * public, reusable links (the same €349 setup + €129/mo products for every
 * voice customer), so they live here rather than per-business. Overridable
 * without a deploy via env if the products ever change.
 *
 * The monthly link is only shown to a customer once their setup fee is marked
 * paid (businesses.subscription_status advances to 'setup_paid' or 'active'),
 * so nobody starts a subscription before onboarding is paid for.
 */
export const SETUP_PAYMENT_LINK =
  process.env.STRIPE_SETUP_PAYMENT_LINK ||
  "https://buy.stripe.com/fZu4gz0leaQ96yA8yF9bO00";

export const MONTHLY_PAYMENT_LINK =
  process.env.STRIPE_MONTHLY_PAYMENT_LINK ||
  "https://buy.stripe.com/28E28r4Bu1fze124ip9bO01";

/** Billing stages, in order. subscription_status holds one of these. */
export const BILLING_STAGES = ["inactive", "setup_paid", "active"] as const;
export type BillingStage = (typeof BILLING_STAGES)[number];

/** Setup fee counts as paid once we're past 'inactive'. */
export function isSetupPaid(status: string | null | undefined): boolean {
  return status === "setup_paid" || status === "active";
}
