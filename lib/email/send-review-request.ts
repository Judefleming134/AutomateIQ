import "server-only";
import { getResendClient, getFromAddress } from "./resend";
import { ReviewRequestEmail } from "./templates/review-request";

export async function sendReviewRequestEmail(params: {
  requestId: string;
  kind: "initial" | "reminder";
  customerName: string;
  customerEmail: string;
  businessName: string;
  googleReviewLink: string;
  logoUrl?: string | null;
  signature?: string | null;
  clickToken: string;
}) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  const reviewUrl = `${siteUrl}/api/r/${params.clickToken}`;

  const resend = getResendClient();

  return resend.emails.send(
    {
      from: getFromAddress(),
      to: params.customerEmail,
      subject:
        params.kind === "reminder"
          ? `Just a reminder — we'd love your feedback`
          : `We'd love your feedback`,
      react: ReviewRequestEmail({
        businessName: params.businessName,
        customerName: params.customerName,
        reviewUrl,
        logoUrl: params.logoUrl,
        signature: params.signature,
        isReminder: params.kind === "reminder",
      }),
    },
    {
      // Prevents a retried request (our own Route Handler timing out and
      // being retried, or a genuinely duplicate call) from causing Resend
      // itself to double-send the same email.
      idempotencyKey: `review-${params.kind}-${params.requestId}`,
    }
  );
}
