import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { isBookableSlot } from "@/lib/booking/slots";
import {
  sendBookingConfirmation,
  sendOwnerNotification,
} from "@/lib/email/send-booking-emails";

const bookingSchema = z.object({
  slot: z.string().trim().min(1),
  name: z.string().trim().min(1, "Please enter your name").max(120),
  company: z.string().trim().max(160).optional().or(z.literal("")),
  email: z.string().trim().email("Please enter a valid email").max(200),
  phone: z.string().trim().max(60).optional().or(z.literal("")),
  businessType: z.string().trim().max(120).optional().or(z.literal("")),
  message: z.string().trim().max(2000).optional().or(z.literal("")),
});

/**
 * Public booking endpoint for the AI Strategy Session page. No session
 * (public visitors) — writes via the service-role client, like Website Agent
 * lead capture. Availability is validated server-side and, decisively, by the
 * DB's partial unique index on slot_at, so two people racing for the same slot
 * can't both win.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = bookingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 }
    );
  }
  const d = parsed.data;

  // Server-side availability guard (structure + lead time + weekday).
  if (!isBookableSlot(d.slot, new Date())) {
    return NextResponse.json(
      { error: "That time is no longer available. Please pick another slot." },
      { status: 409 }
    );
  }

  const supabase = createAdminClient();

  // Abuse guard on a PUBLIC endpoint: every accepted booking holds a calendar
  // slot AND sends two emails — one of them to whatever address the caller
  // typed. Unbounded, that's a way to burn the sending domain's reputation on
  // a third party and to block the calendar with junk so real prospects can't
  // book. Nobody legitimately books three sessions in a day; a genuine
  // reschedule is two. Fails OPEN if the count query itself errors — losing a
  // real booking is worse than letting one extra through.
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count: recentForEmail, error: countError } = await supabase
    .from("strategy_bookings")
    .select("id", { count: "exact", head: true })
    .ilike("email", d.email.replace(/([%_\\])/g, "\\$1"))
    .gte("created_at", dayAgo);
  if (!countError && (recentForEmail ?? 0) >= 3) {
    return NextResponse.json(
      {
        error:
          "You already have sessions booked with that email. Reply to your confirmation email and we'll sort the timing.",
      },
      { status: 429 }
    );
  }

  const { data: booking, error } = await supabase
    .from("strategy_bookings")
    .insert({
      name: d.name,
      company: d.company || null,
      email: d.email,
      phone: d.phone || null,
      business_type: d.businessType || null,
      message: d.message || null,
      slot_at: d.slot,
      status: "pending",
    })
    .select("id, name, email, company, phone, business_type, message, slot_at")
    .single();

  if (error) {
    // 23505 = unique_violation on the active-slot index → someone booked it.
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "That time was just taken. Please pick another slot." },
        { status: 409 }
      );
    }
    console.error("Booking insert failed:", error);
    return NextResponse.json({ error: "Could not save your booking." }, { status: 502 });
  }

  // Emails are best-effort — the booking is already stored, so a mail failure
  // must not fail the request or lose the booking. Fire both in parallel:
  // they're independent (visitor confirmation vs owner alert), and the owner
  // alert does its own admin-email lookup first, so running them concurrently
  // trims the visitor's wait from the sum of both to the slower of the two.
  const [confirmation, ownerNotify] = await Promise.allSettled([
    sendBookingConfirmation(booking),
    sendOwnerNotification(booking),
  ]);
  if (confirmation.status === "rejected") {
    console.error("Booking confirmation email failed:", confirmation.reason);
  }
  if (ownerNotify.status === "rejected") {
    console.error("Owner notification failed:", ownerNotify.reason);
  }

  return NextResponse.json({ ok: true });
}
