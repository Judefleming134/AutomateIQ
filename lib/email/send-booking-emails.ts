import "server-only";
import { getResendClient, getFromAddress } from "./resend";
import { StrategySessionEmail } from "./templates/strategy-session";
import { formatSlot, BOOKING_CONFIG } from "@/lib/booking/slots";

type Booking = {
  id: string;
  name: string;
  email: string;
  company?: string | null;
  phone?: string | null;
  business_type?: string | null;
  message?: string | null;
  slot_at: string;
};

/**
 * Owner notification address. Set BOOKING_NOTIFY_EMAIL to the inbox that
 * should be alerted the moment a session is booked. Falls back to
 * RESEND_FROM_EMAIL's address so notifications still arrive somewhere sensible
 * before it's configured.
 */
function ownerNotifyAddress(): string | null {
  if (process.env.BOOKING_NOTIFY_EMAIL) return process.env.BOOKING_NOTIFY_EMAIL;
  const from = process.env.RESEND_FROM_EMAIL;
  if (from) {
    const m = /<([^>]+)>/.exec(from);
    return m ? m[1] : from;
  }
  return null;
}

/** Confirmation to the visitor. `confirmed` = owner-approved vs. just received. */
export async function sendBookingConfirmation(booking: Booking, confirmed = false) {
  const resend = getResendClient();
  const result = await resend.emails.send(
    {
      from: getFromAddress(),
      to: booking.email,
      subject: confirmed
        ? "Your AutomateIQ AI Strategy Session is confirmed"
        : "We've received your AI Strategy Session request",
      react: StrategySessionEmail({
        name: booking.name,
        slotLabel: formatSlot(booking.slot_at),
        timezoneLabel: BOOKING_CONFIG.timezoneLabel,
        durationLabel: BOOKING_CONFIG.durationLabel,
        confirmed,
      }),
    },
    // One confirmation per (booking, kind) even under retries.
    { idempotencyKey: `booking-${confirmed ? "confirmed" : "received"}-${booking.id}` }
  );
  if (result.error) {
    throw new Error(`Resend rejected the confirmation email: ${result.error.message}`);
  }
  return result;
}

/** Immediate alert to the owner with the full booking details. */
export async function sendOwnerNotification(booking: Booking) {
  const to = ownerNotifyAddress();
  if (!to) {
    console.error("No BOOKING_NOTIFY_EMAIL / RESEND_FROM_EMAIL set — owner not notified.");
    return;
  }
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://automateiq.ie";
  const resend = getResendClient();
  const result = await resend.emails.send(
    {
      from: getFromAddress(),
      to,
      subject: `New AI Strategy Session booking — ${booking.name}${
        booking.company ? ` (${booking.company})` : ""
      }`,
      text: [
        `A new AI Strategy Session has been booked.`,
        ``,
        `When:     ${formatSlot(booking.slot_at)} (${BOOKING_CONFIG.timezoneLabel})`,
        `Name:     ${booking.name}`,
        `Company:  ${booking.company || "—"}`,
        `Email:    ${booking.email}`,
        `Phone:    ${booking.phone || "—"}`,
        `Type:     ${booking.business_type || "—"}`,
        ``,
        `What they want help with:`,
        booking.message || "—",
        ``,
        `Manage it here: ${siteUrl}/admin/bookings`,
      ].join("\n"),
    },
    { idempotencyKey: `booking-owner-${booking.id}` }
  );
  if (result.error) {
    console.error("Owner booking notification rejected:", result.error);
  }
  return result;
}
