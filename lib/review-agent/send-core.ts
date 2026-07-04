import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendReviewRequestEmail } from "@/lib/email/send-review-request";

export type SendReviewRequestResult =
  | { ok: true; customerName: string }
  | { ok: false; error: string };

/**
 * Core review-request send flow, shared by the Review Agent's send form and
 * the AI Assistant's `send_review_request` tool. The caller is responsible
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
  // from the business's sending identity. Queried from ra_review_requests
  // (not ra_customers) because a new ra_customers row is created on every
  // send — the same email can have several customer rows over time, so the
  // check has to look at requests across all of them.
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data: recentRequests } = await supabase
    .from("ra_review_requests")
    .select("id, created_at, status, ra_customers!inner(email)")
    .eq("business_id", businessId)
    .eq("ra_customers.email", customerEmail)
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

  const { data: customer, error: customerError } = await supabase
    .from("ra_customers")
    .insert({ business_id: businessId, name: customerName, email: customerEmail })
    .select("id")
    .single();

  if (customerError || !customer) {
    return { ok: false, error: customerError?.message ?? "Could not save customer." };
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

  return { ok: true, customerName };
}
