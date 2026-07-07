import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { dublinDate } from "@/lib/growth/dates";

/**
 * Marks outreach as having gone out: message row + prospect bookkeeping +
 * the automatic follow-up. Sending moves new/researched prospects to
 * "Contacted" and schedules a follow-up reminder 3 days out, so the
 * dashboard chases the reply without anyone having to remember to.
 * Shared by the composer, the queue view and the email autopilot so every
 * send updates the CRM identically.
 */
export async function recordOutreachSent(
  prospect: { id: string; status: string },
  messageId: string,
  channel: string,
  memberName: string,
  memberId: string,
  purpose?: string | null
) {
  const admin = createAdminClient();
  await admin
    .from("ge_messages")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", messageId);
  const bump: Record<string, unknown> = {
    last_contact_at: new Date().toISOString(),
    next_follow_up_at: dublinDate(3),
  };
  // First outreach → Contacted; chasing an unanswered prospect (or sending
  // an explicit follow-up draft) → Follow-up sent. Later stages (replied,
  // qualified, …) are never regressed by sending another message.
  if (
    ["new", "researching", "research_complete", "outreach_ready"].includes(
      prospect.status
    )
  ) {
    bump.status = "contacted";
  } else if (
    ["contacted", "follow_up_sent"].includes(prospect.status) ||
    (purpose && ["follow_up", "second_follow_up"].includes(purpose) &&
      !["replied", "qualified", "meeting_booked", "proposal_in_progress",
        "proposal_sent", "negotiation", "won"].includes(prospect.status))
  ) {
    bump.status = "follow_up_sent";
  }
  await admin.from("ge_prospects").update(bump).eq("id", prospect.id);
  await admin.from("ge_activities").insert({
    prospect_id: prospect.id,
    type: channel,
    content:
      channel === "call"
        ? `Call made by ${memberName} — follow-up scheduled in 3 days`
        : `Outreach sent via ${channel} by ${memberName} — follow-up scheduled in 3 days`,
    created_by: memberId,
  });
}
