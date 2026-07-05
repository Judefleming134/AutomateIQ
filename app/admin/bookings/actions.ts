"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAdminAction } from "@/lib/audit";
import { sendBookingConfirmation } from "@/lib/email/send-booking-emails";

type Result = { ok?: boolean; error?: string } | undefined;

async function loadBooking(id: string) {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("strategy_bookings")
    .select("id, name, email, company, phone, business_type, message, slot_at, status")
    .eq("id", id)
    .maybeSingle();
  return data;
}

/** Approve → confirmed, and email the visitor an owner-confirmed confirmation. */
export async function approveBooking(id: string): Promise<Result> {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  const booking = await loadBooking(id);
  if (!booking) return { error: "Booking not found." };

  const { error } = await supabase
    .from("strategy_bookings")
    .update({ status: "confirmed" })
    .eq("id", id);
  if (error) return { error: error.message };

  try {
    await sendBookingConfirmation(booking, true);
  } catch (err) {
    console.error("Confirmation email failed:", err);
  }

  await logAdminAction({ actorId: admin.id, action: "booking.approve", metadata: { id } });
  revalidatePath("/admin/bookings");
  return { ok: true };
}

export async function cancelBooking(id: string): Promise<Result> {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("strategy_bookings")
    .update({ status: "cancelled" })
    .eq("id", id);
  if (error) return { error: error.message };

  await logAdminAction({ actorId: admin.id, action: "booking.cancel", metadata: { id } });
  revalidatePath("/admin/bookings");
  return { ok: true };
}

export async function completeBooking(id: string): Promise<Result> {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("strategy_bookings")
    .update({ status: "completed" })
    .eq("id", id);
  if (error) return { error: error.message };

  await logAdminAction({ actorId: admin.id, action: "booking.complete", metadata: { id } });
  revalidatePath("/admin/bookings");
  return { ok: true };
}

/**
 * Reschedule to a new time. The admin picks a datetime-local value ("wall
 * clock"); we store it as the matching consistent instant. The DB's active-slot
 * unique index rejects a clash with another live booking.
 */
export async function rescheduleBooking(
  _prev: Result,
  formData: FormData
): Promise<Result> {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  const id = String(formData.get("id") ?? "");
  const local = String(formData.get("slot") ?? "").trim(); // "YYYY-MM-DDTHH:MM"
  if (!id) return { error: "Missing booking id." };
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) {
    return { error: "Pick a valid date and time." };
  }
  const slotIso = `${local}:00.000Z`;

  const booking = await loadBooking(id);
  if (!booking) return { error: "Booking not found." };

  const { error } = await supabase
    .from("strategy_bookings")
    .update({ slot_at: slotIso, status: "rescheduled" })
    .eq("id", id);
  if (error) {
    if (error.code === "23505") {
      return { error: "Another active booking already holds that time." };
    }
    return { error: error.message };
  }

  // Re-send a confirmation with the new time.
  try {
    await sendBookingConfirmation({ ...booking, slot_at: slotIso }, true);
  } catch (err) {
    console.error("Reschedule email failed:", err);
  }

  await logAdminAction({
    actorId: admin.id,
    action: "booking.reschedule",
    metadata: { id, slot: slotIso },
  });
  revalidatePath("/admin/bookings");
  return { ok: true };
}
