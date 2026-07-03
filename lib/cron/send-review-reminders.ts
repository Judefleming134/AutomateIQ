import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendReviewRequestEmail } from "@/lib/email/send-review-request";

type ClaimedRequest = {
  id: string;
  business_id: string;
  ra_customer_id: string;
  click_token: string;
};

/**
 * Claims due reminders atomically (see supabase/migrations/
 * 0004_claim_reminders_function.sql — FOR UPDATE SKIP LOCKED, tested
 * directly against Postgres to confirm a repeated/overlapping call claims
 * zero additional rows), then sends exactly one reminder email per claimed
 * row. A row is claimed (status='reminded') BEFORE its email is sent, so
 * the worst case on a Resend failure is "claimed but the send failed"
 * (logged, left as-is — not retried by design, since retrying here would
 * reopen the exact double-send window the claim step exists to close),
 * never a duplicate reminder.
 */
export async function sendReviewReminders() {
  const admin = createAdminClient();

  const { data: claimed, error: claimError } = await admin.rpc(
    "claim_due_reminders",
    { batch_size: 200 }
  );

  if (claimError) {
    console.error("claim_due_reminders RPC failed:", claimError);
    return { claimed: 0, sent: 0, failed: 0, error: claimError.message };
  }

  const rows = (claimed ?? []) as ClaimedRequest[];
  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const [{ data: business }, { data: customer }] = await Promise.all([
        admin
          .from("businesses")
          .select("name, google_review_link, logo_url, email_signature")
          .eq("id", row.business_id)
          .single(),
        admin
          .from("ra_customers")
          .select("name, email")
          .eq("id", row.ra_customer_id)
          .single(),
      ]);

      if (!business?.google_review_link || !customer?.email) {
        console.error(
          `Skipping reminder for ${row.id}: missing business review link or customer email`
        );
        failed++;
        continue;
      }

      await sendReviewRequestEmail({
        requestId: row.id,
        kind: "reminder",
        customerName: customer.name,
        customerEmail: customer.email,
        businessName: business.name,
        googleReviewLink: business.google_review_link,
        logoUrl: business.logo_url,
        signature: business.email_signature,
        clickToken: row.click_token,
      });
      sent++;
    } catch (err) {
      console.error(`Reminder email failed for request ${row.id}:`, err);
      failed++;
    }
  }

  return { claimed: rows.length, sent, failed };
}
