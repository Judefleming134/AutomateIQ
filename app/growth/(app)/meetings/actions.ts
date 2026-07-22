"use server";

import { revalidatePath } from "next/cache";
import { requireGrowth } from "@/lib/growth/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyGrowthTeam } from "@/lib/growth/email";
import { dublinLocalToUtcISO } from "@/lib/growth/dates";
import { syncStrategyBookingsCore, markMeetingBooked } from "@/lib/growth/booking-sync";

type Result = { ok?: boolean; error?: string } | undefined;

export async function recordMeeting(_prev: Result, formData: FormData): Promise<Result> {
  const { member } = await requireGrowth();
  const prospectId = String(formData.get("prospect_id") ?? "");
  const scheduledAtRaw = String(formData.get("scheduled_at") ?? "");
  const notes = String(formData.get("notes") ?? "").trim() || null;
  if (!prospectId) return { error: "Pick a prospect." };
  // The datetime-local value is IRISH wall-clock time; anchor it to Dublin
  // so 14:00 stored is 14:00 shown (not +1h from the server reading UTC).
  const scheduledIso = dublinLocalToUtcISO(scheduledAtRaw);
  if (!scheduledIso) return { error: "Pick a valid date and time." };

  const admin = createAdminClient();
  const { data: prospect } = await admin
    .from("ge_prospects")
    .select("id, company, contact_name, email")
    .eq("id", prospectId)
    .maybeSingle();
  if (!prospect) return { error: "Prospect not found." };

  const { error } = await admin.from("ge_meetings").insert({
    prospect_id: prospectId,
    scheduled_at: scheduledIso,
    notes,
  });
  if (error) return { error: error.message };

  await markMeetingBooked(admin, prospectId);
  await admin.from("ge_activities").insert({
    prospect_id: prospectId,
    type: "meeting",
    content: `Meeting booked for ${new Date(scheduledIso).toLocaleString("en-IE", { timeZone: "Europe/Dublin" })} by ${member.name}`,
    created_by: member.id,
  });

  // Same recipients as public booking alerts — admins hear about Growth
  // Engine meetings exactly like website bookings. Best-effort.
  await notifyGrowthTeam(`Growth Engine: meeting booked — ${prospect.company}`, [
    `A meeting was recorded in the Growth Engine by ${member.name}.`,
    "",
    `Company: ${prospect.company}`,
    `Contact: ${prospect.contact_name}${prospect.email ? ` (${prospect.email})` : ""}`,
    `When: ${new Date(scheduledIso).toLocaleString("en-IE", { timeZone: "Europe/Dublin" })} (Irish time)`,
    notes ? `Notes: ${notes}` : "",
  ].filter(Boolean));

  revalidatePath("/growth/meetings");
  revalidatePath(`/growth/prospects/${prospectId}`);
  return { ok: true };
}

export async function setMeetingStatus(_prev: Result, formData: FormData): Promise<Result> {
  const { member } = await requireGrowth();
  const id = String(formData.get("meeting_id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !["booked", "completed", "cancelled", "no_show"].includes(status)) {
    return { error: "Invalid status." };
  }

  const admin = createAdminClient();
  const { data: meeting } = await admin
    .from("ge_meetings")
    .select("id, prospect_id, status")
    .eq("id", id)
    .maybeSingle();
  if (!meeting) return { error: "Meeting not found." };

  const { error } = await admin.from("ge_meetings").update({ status }).eq("id", id);
  if (error) return { error: error.message };

  // Log the outcome to the prospect's timeline so the call record stays
  // complete — a completed / no-show / cancelled outcome was previously
  // invisible on the prospect page Jude reads before the next call.
  if (meeting.prospect_id && status !== meeting.status && status !== "booked") {
    const label: Record<string, string> = {
      completed: "Meeting completed",
      no_show: "Meeting no-show",
      cancelled: "Meeting cancelled",
    };
    await admin.from("ge_activities").insert({
      prospect_id: meeting.prospect_id,
      type: "meeting",
      content: `${label[status] ?? status} — marked by ${member.name}`,
      created_by: member.id,
    });
    revalidatePath(`/growth/prospects/${meeting.prospect_id}`);
  }

  revalidatePath("/growth/meetings");
  return { ok: true };
}

/**
 * Pulls AI Strategy Sessions booked through the public /book page into the
 * Growth Engine by matching the booking email to a prospect. Read-only
 * against strategy_bookings (the customer platform is never written to);
 * idempotent via the unique index on strategy_booking_id.
 */
export async function syncStrategyBookings(_prev: Result, formData: FormData): Promise<
  Result & { matched?: number }
> {
  const { member } = await requireGrowth();
  void formData;
  const admin = createAdminClient();

  const { matched, error } = await syncStrategyBookingsCore(admin, {
    createdBy: member.id,
    attributedTo: member.name,
  });
  if (error) return { error };

  revalidatePath("/growth/meetings");
  revalidatePath("/growth/prospects");
  return { ok: true, matched };
}
