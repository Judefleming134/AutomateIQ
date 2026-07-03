"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/require-session";
import { requireProductEnabled } from "@/lib/auth/require-product";
import { createClient } from "@/lib/supabase/server";
import { sendReviewRequestEmail } from "@/lib/email/send-review-request";

const sendSchema = z.object({
  customerName: z.string().trim().min(1, "Customer name is required"),
  customerEmail: z.string().trim().email("A valid email is required"),
});

export async function sendReviewRequest(
  _prevState: { error?: string; ok?: boolean } | undefined,
  formData: FormData
) {
  const { profile } = await requireSession();
  const businessId = profile.business_id!;

  const enabled = await requireProductEnabled(businessId, "review-agent");
  if (!enabled) {
    return { error: "Review Agent is not enabled for your account." };
  }

  const parsed = sendSchema.safeParse({
    customerName: formData.get("customerName"),
    customerEmail: formData.get("customerEmail"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { customerName, customerEmail } = parsed.data;

  const supabase = await createClient();

  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .select("name, google_review_link, logo_url, email_signature")
    .eq("id", businessId)
    .single();

  if (businessError || !business) {
    return { error: "Could not load your business settings." };
  }
  if (!business.google_review_link) {
    return {
      error:
        "Add a Google Review Link in Settings before sending review requests.",
    };
  }

  // Duplicate-submit guard: a fat-fingered double click (or an eager
  // re-click before the page updates) shouldn't send two initial emails
  // from the business's sending identity. The submit button also disables
  // itself while pending (see the client form) — this is the backup.
  // Queried from ra_review_requests (not ra_customers) because a new
  // ra_customers row is created on every send — the same email can have
  // several customer rows over time, so the check has to look at requests
  // across all of them, not just the most recently created customer row.
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
      error: "A review request was already just sent to this email.",
    };
  }

  const { data: customer, error: customerError } = await supabase
    .from("ra_customers")
    .insert({ business_id: businessId, name: customerName, email: customerEmail })
    .select("id")
    .single();

  if (customerError || !customer) {
    return { error: customerError?.message ?? "Could not save customer." };
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
    return { error: requestError?.message ?? "Could not create review request." };
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
      error: `Saved, but the email failed to send: ${err instanceof Error ? err.message : "unknown error"}`,
    };
  }

  await supabase
    .from("ra_review_requests")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", reviewRequest.id);

  revalidatePath("/portal/review-agent");
  revalidatePath("/portal/review-agent/customers");
  revalidatePath("/portal/review-agent/history");
  return { ok: true };
}
