import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendReviewRequestEmail } from "@/lib/email/send-review-request";
import { escapeLike } from "@/lib/growth/db";
import { ingestCrmContact } from "@/lib/crm/ingest";

export type SendReviewRequestResult =
  | { ok: true; customerName: string }
  | { ok: false; error: string };

/**
 * Core review-request send flow, shared by ReputationIQ's send form and
 * AssistIQ's `send_review_request` tool. The caller is responsible
 * for auth + entitlement checks; `supabase` must be the RLS-scoped server
 * client so every read/write stays inside the caller's own business.
 */
export async function sendReviewRequestCore(
  supabase: SupabaseClient,
  businessId: string,
  customerName: string,
  customerEmail: string
): Promise<SendReviewRequestResult> {
  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .select("name, google_review_link, logo_url, email_signature")
    .eq("id", businessId)
    .single();

  if (businessError || !business) {
    return { ok: false, error: "Could not load your business settings." };
  }
  if (!business.google_review_link) {
    return {
      ok: false,
      error:
        "Add a Google Review Link in Settings before sending review requests.",
    };
  }

  // Duplicate-submit guard: a fat-fingered double click (or an eager
  // re-click before the page updates) shouldn't send two initial emails
  // from the business's sending identity — to their own customer.
  //
  // Matched case-INSENSITIVELY. A plain .eq() compares byte-for-byte, so
  // re-typing "Mary.Byrne@gmail.com" a minute after "mary.byrne@gmail.com"
  // walked straight past this guard and sent a second review request. Exactly
  // the hole already closed in /api/book and /api/lead. The wildcards are
  // escaped because % and _ are legal in an email local part.
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data: recentRequests } = await supabase
    .from("ra_review_requests")
    .select("id, created_at, status, ra_customers!inner(email)")
    .eq("business_id", businessId)
    .ilike("ra_customers.email", escapeLike(customerEmail))
    .order("created_at", { ascending: false })
    .limit(1);

  const recentRequest = recentRequests?.[0];
  if (
    recentRequest &&
    recentRequest.created_at > fiveMinutesAgo &&
    ["pending", "sent"].includes(recentRequest.status)
  ) {
    return {
      ok: false,
      error: "A review request was already just sent to this email.",
    };
  }

  // Reuse the customer row rather than inserting a new one on every send.
  // A new row per send meant the Customers page listed the same person once
  // per review request ever sent to them — six rows for two people after a
  // fortnight — and the per-customer request and click counts underneath were
  // split across those rows, so nobody's real history was visible anywhere.
  //
  // Scoped by business_id as well as email: this table is multi-tenant, and
  // two businesses can legitimately have the same customer.
  const { data: existingCustomer } = await supabase
    .from("ra_customers")
    .select("id, name")
    .eq("business_id", businessId)
    .ilike("email", escapeLike(customerEmail))
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  let customer: { id: string } | null = existingCustomer
    ? { id: existingCustomer.id }
    : null;

  if (existingCustomer) {
    // A corrected spelling on a later send should stick, otherwise the review
    // email keeps greeting them by the name that was wrong the first time.
    if (customerName && customerName !== existingCustomer.name) {
      await supabase
        .from("ra_customers")
        .update({ name: customerName })
        .eq("id", existingCustomer.id);
    }
  } else {
    const { data: created, error: customerError } = await supabase
      .from("ra_customers")
      .insert({ business_id: businessId, name: customerName, email: customerEmail })
      .select("id")
      .single();
    if (customerError || !created) {
      return { ok: false, error: customerError?.message ?? "Could not save customer." };
    }
    customer = created;
  }

  if (!customer) {
    return { ok: false, error: "Could not save customer." };
  }

  // Durable record BEFORE the external call — a Resend failure must never
  // leave zero trace that we tried.
  const { data: reviewRequest, error: requestError } = await supabase
    .from("ra_review_requests")
    .insert({
      business_id: businessId,
      ra_customer_id: customer.id,
      status: "pending",
    })
    .select("id, click_token")
    .single();

  if (requestError || !reviewRequest) {
    return {
      ok: false,
      error: requestError?.message ?? "Could not create review request.",
    };
  }

  try {
    await sendReviewRequestEmail({
      requestId: reviewRequest.id,
      kind: "initial",
      customerName,
      customerEmail,
      businessName: business.name,
      googleReviewLink: business.google_review_link,
      logoUrl: business.logo_url,
      signature: business.email_signature,
      clickToken: reviewRequest.click_token,
    });
  } catch (err) {
    await supabase
      .from("ra_review_requests")
      .update({ status: "failed" })
      .eq("id", reviewRequest.id);
    return {
      ok: false,
      error: `Saved, but the email failed to send: ${err instanceof Error ? err.message : "unknown error"}`,
    };
  }

  await supabase
    .from("ra_review_requests")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", reviewRequest.id);

  // ClientIQ, immediately. A review request means a job just finished — which
  // makes them a customer, not a lead — and until now that only reached the
  // CRM if somebody pressed Import. Stage 'won' because the work is done and
  // paid-for enough to be asking for a review; highestStage() means this can
  // only ever move them forward, never back.
  //
  // Best-effort and last: the request has already been sent, so nothing here
  // may turn a successful send into a reported failure.
  const crm = await ingestCrmContact(supabase, {
    businessId,
    name: customerName,
    email: customerEmail,
    source: "ReputationIQ",
    activity: `Review request sent${business?.name ? ` by ${business.name}` : ""}`,
    stage: "won",
  });
  if (!crm.ok) {
    console.error(`[review-send] ClientIQ ingest failed for ${customerEmail}: ${crm.reason}`);
  }

  return { ok: true, customerName };
}
