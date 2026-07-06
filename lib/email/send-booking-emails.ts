import "server-only";
import { getResendClient, getFromAddress } from "./resend";
import { StrategySessionEmail } from "./templates/strategy-session";
import { formatSlot, BOOKING_CONFIG } from "@/lib/booking/slots";
import { createAdminClient } from "@/lib/supabase/admin";

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

function fromAddressInbox(): string | null {
  const from = process.env.RESEND_FROM_EMAIL;
  if (!from) return null;
  const m = /<([^>]+)>/.exec(from);
  return m ? m[1] : from;
}

/**
 * Who to alert when a session is booked. Resolves, in order, and de-duplicates:
 *   1. BOOKING_NOTIFY_EMAIL (optional override; comma-separated allowed)
 *   2. every platform admin's login email, read from the DB via the
 *      service-role client — so notifications work with ZERO configuration
 *      (the owner is simply notified at the address they log into /admin with)
 *   3. the RESEND_FROM_EMAIL address, as a last resort
 * Best-effort: any lookup failure just falls through to the next source.
 */
export async function ownerNotifyRecipients(): Promise<string[]> {
  const recipients = new Set<string>();

  const override = process.env.BOOKING_NOTIFY_EMAIL;
  if (override) {
    for (const e of override.split(",")) {
      const t = e.trim();
      if (t) recipients.add(t);
    }
  }

  try {
    const supabase = createAdminClient();
    const { data: admins } = await supabase
      .from("profiles")
      .select("id")
      .eq("role", "admin");
    for (const a of admins ?? []) {
      const { data } = await supabase.auth.admin.getUserById(a.id);
      const email = data?.user?.email;
      if (email) recipients.add(email);
    }
  } catch (err) {
    console.error("Could not resolve admin emails for booking notification:", err);
  }

  if (recipients.size === 0) {
    const fallback = fromAddressInbox();
    if (fallback) recipients.add(fallback);
  }

  return [...recipients];
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

/** Immediate alert to the owner(s) with the full booking details. */
export async function sendOwnerNotification(booking: Booking) {
  const to = await ownerNotifyRecipients();
  if (to.length === 0) {
    console.error(
      "No booking notification recipients (no admin account email, BOOKING_NOTIFY_EMAIL, or RESEND_FROM_EMAIL) — owner not notified."
    );
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
