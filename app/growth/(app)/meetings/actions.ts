"use server";

import { revalidatePath } from "next/cache";
import { requireGrowth } from "@/lib/growth/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyGrowthTeam } from "@/lib/growth/email";
import { dublinLocalToUtcISO } from "@/lib/growth/dates";

type Result = { ok?: boolean; error?: string } | undefined;

async function markMeetingBooked(prospectId: string) {
  const admin = createAdminClient();
  const { data: prospect } = await admin
    .from("ge_prospects")
    .select("status")
    .eq("id", prospectId)
    .maybeSingle();
  if (
    prospect &&
    !["meeting_booked", "proposal_in_progress", "proposal_sent", "negotiation",
      "won", "lost", "do_not_contact", "archived"].includes(prospect.status)
  ) {
    await admin
      .from("ge_prospects")
      .update({ status: "meeting_booked" })
      .eq("id", prospectId);
  }
}

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

  await markMeetingBooked(prospectId);
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
  await requireGrowth();
  const id = String(formData.get("meeting_id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !["booked", "completed", "cancelled", "no_show"].includes(status)) {
    return { error: "Invalid status." };
  }

  const admin = createAdminClient();
  const { error } = await admin.from("ge_meetings").update({ status }).eq("id", id);
  if (error) return { error: error.message };

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

  const { data: bookings, error } = await admin
    .from("strategy_bookings")
    .select("id, name, email, company, slot_at, status")
    .in("status", ["pending", "confirmed", "rescheduled", "completed"]);
  if (error) {
    return {
      error:
        "Could not read bookings — has supabase/manual_update_0010.sql been run?",
    };
  }

  let matched = 0;
  for (const b of bookings ?? []) {
    const { data: prospect } = await admin
      .from("ge_prospects")
      .select("id, company, status")
      .ilike("email", b.email)
      .maybeSingle();
    if (!prospect) continue;

    const { data: created, error: insertError } = await admin
      .from("ge_meetings")
      .insert({
        prospect_id: prospect.id,
        scheduled_at: b.slot_at,
        status: b.status === "completed" ? "completed" : "booked",
        notes: `AI Strategy Session booked via the public booking page (${b.name}${b.company ? `, ${b.company}` : ""}).`,
        strategy_booking_id: b.id,
      })
      .select("id")
      .single();
    if (insertError) continue; // already synced (unique index) — skip quietly

    matched++;
    await markMeetingBooked(prospect.id);
    await admin.from("ge_activities").insert({
      prospect_id: prospect.id,
      type: "meeting",
      content: "AI Strategy Session booked through the public booking page (synced).",
      created_by: member.id,
    });
    await notifyGrowthTeam(
      `Growth Engine: prospect booked a Strategy Session — ${prospect.company}`,
      [
        `${b.name} (${b.email}) booked an AI Strategy Session and matches Growth Engine prospect "${prospect.company}".`,
        `Slot: ${new Date(b.slot_at).toLocaleString("en-IE", { timeZone: "Europe/Dublin" })} (Irish time)`,
        `Synced by ${member.name}.`,
      ]
    );
    void created;
  }

  revalidatePath("/growth/meetings");
  revalidatePath("/growth/prospects");
  return { ok: true, matched };
}
