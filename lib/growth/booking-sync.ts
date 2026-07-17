import { escapeLike } from "@/lib/growth/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyGrowthTeam } from "@/lib/growth/email";

/**
 * Shared core for pulling AI Strategy Sessions booked through the public
 * /book page into the Growth Engine as meetings. Extracted so it can run
 * BOTH from the on-page "Sync bookings → meetings" button (with a signed-in
 * member for attribution) AND unattended from the 07:00 cron dispatch — a
 * booked call should never wait for Jude to remember to click.
 *
 * Read-only against strategy_bookings (the customer platform is never
 * written to). Idempotent via the unique index on strategy_booking_id, so
 * running it every morning only ever inserts genuinely-new bookings.
 *
 * `createdBy` stamps the activity author: a member id from the button, or
 * null from the cron (a system sync). `attributedTo` labels the notify
 * email ("Jude" vs "the overnight engine").
 */
export async function syncStrategyBookingsCore(
  admin: SupabaseClient,
  opts: { createdBy: string | null; attributedTo: string }
): Promise<{ matched: number; error?: string }> {
  const { data: bookings, error } = await admin
    .from("strategy_bookings")
    .select("id, name, email, company, slot_at, status")
    .in("status", ["pending", "confirmed", "rescheduled", "completed"]);
  if (error) {
    return {
      matched: 0,
      error:
        "Could not read bookings — has supabase/manual_update_0010.sql been run?",
    };
  }

  let matched = 0;
  for (const b of bookings ?? []) {
    if (!b.email) continue;
    const { data: prospect } = await admin
      .from("ge_prospects")
      .select("id, company, status")
      .ilike("email", escapeLike(b.email))
      .maybeSingle();
    if (!prospect) continue;

    const { error: insertError } = await admin
      .from("ge_meetings")
      .insert({
        prospect_id: prospect.id,
        scheduled_at: b.slot_at,
        status: b.status === "completed" ? "completed" : "booked",
        notes: `AI Strategy Session booked via the public booking page (${b.name}${b.company ? `, ${b.company}` : ""}).`,
        strategy_booking_id: b.id,
      });
    if (insertError) continue; // already synced (unique index) — skip quietly

    matched++;
    await markMeetingBooked(admin, prospect.id);
    await admin.from("ge_activities").insert({
      prospect_id: prospect.id,
      type: "meeting",
      content: "AI Strategy Session booked through the public booking page (synced).",
      created_by: opts.createdBy,
    });
    await notifyGrowthTeam(
      `Growth Engine: prospect booked a Strategy Session — ${prospect.company}`,
      [
        `${b.name} (${b.email}) booked an AI Strategy Session and matches Growth Engine prospect "${prospect.company}".`,
        // Booking slots store the Irish wall-clock time AS UTC (14:00 session
        // = 14:00Z), so render in UTC — a Dublin conversion would email the
        // time an hour late in summer.
        `Slot: ${new Date(b.slot_at).toLocaleString("en-IE", { timeZone: "UTC" })} (Irish time)`,
        `Synced by ${opts.attributedTo}.`,
      ]
    );
  }

  return { matched };
}

/**
 * Advances a prospect to meeting_booked unless it's already at or past that
 * stage. Shared by the manual and automated sync paths so both keep the
 * pipeline honest.
 */
export async function markMeetingBooked(admin: SupabaseClient, prospectId: string) {
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
