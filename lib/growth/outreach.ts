import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveChaseDate } from "@/lib/growth/dates";

/**
 * The prospect's REAL outreach history, formatted for a drafting prompt — so
 * follow-ups and call scripts reference the message that actually went out
 * (channel, date, subject, gist) instead of inventing "I sent you a note".
 * Newest last, so the model naturally anchors on the most recent touch.
 */
export async function outreachHistoryLines(
  admin: SupabaseClient,
  prospectId: string
): Promise<string[]> {
  const [{ data: sent }, { data: inbound }] = await Promise.all([
    admin
      .from("ge_messages")
      .select("channel, subject, body, sent_at, created_at")
      .eq("prospect_id", prospectId)
      .eq("direction", "outbound")
      .eq("status", "sent")
      .order("sent_at", { ascending: false, nullsFirst: false })
      .limit(5),
    admin
      .from("ge_messages")
      .select("channel, body, created_at")
      .eq("prospect_id", prospectId)
      .eq("direction", "inbound")
      .order("created_at", { ascending: false })
      .limit(2),
  ]);
  const day = (iso: string | null | undefined) =>
    iso
      ? new Date(iso).toLocaleDateString("en-IE", { day: "numeric", month: "short", timeZone: "Europe/Dublin" })
      : "?";
  const entries = [
    ...(sent ?? []).map((m) => ({
      at: m.sent_at ?? m.created_at,
      line: `- ${day(m.sent_at ?? m.created_at)} · we sent a ${m.channel === "email" ? "email" : `${m.channel} message`}${m.subject ? ` (subject: "${m.subject}")` : ""}: "${String(m.body ?? "").slice(0, 160)}"`,
    })),
    ...(inbound ?? []).map((m) => ({
      at: m.created_at,
      line: `- ${day(m.created_at)} · THEY replied via ${m.channel}: "${String(m.body ?? "").slice(0, 160)}"`,
    })),
  ].sort((a, b) => (a.at < b.at ? -1 : 1));
  return entries.map((e) => e.line);
}

/**
 * Marks outreach as having gone out: message row + prospect bookkeeping +
 * the automatic follow-up. Sending moves new/researched prospects to
 * "Contacted" and makes sure a chase is in the diary — three days out when
 * there isn't one, so the dashboard chases the reply without anyone having to
 * remember to. A chase already booked for a later day is left where it is
 * (see resolveChaseDate).
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

  // Multi-channel same-day outreach (LinkedIn DM + Insta DM within hours)
  // is ONE first touch, not a follow-up — only a later send, or an explicit
  // follow-up draft, counts as chasing.
  const { data: fresh } = await admin
    .from("ge_prospects")
    .select("last_contact_at, next_follow_up_at")
    .eq("id", prospect.id)
    .maybeSingle();
  const lastContact = fresh?.last_contact_at
    ? new Date(fresh.last_contact_at).getTime()
    : 0;
  const sameTouchWindow = Date.now() - lastContact < 20 * 60 * 60 * 1000;
  const explicitFollowUp =
    purpose && ["follow_up", "second_follow_up"].includes(purpose);

  // A send can PUT a chase in the diary; it must never MOVE one already
  // there. This was an unconditional +3, and it is the same defect fixed in
  // addActivity — reached from "Mark sent" on the DM list, the composer, the
  // queue view and the 07:00 autopilot, so it fired on every outreach path in
  // the engine. A prospect who said "try us after the summer" had that date
  // pulled from September to three days out, which is a cold DM six weeks
  // early to someone who explicitly asked to be left alone until then.
  //
  // A date that has already come round is still rescheduled: that date IS the
  // chase this send just was.
  const chase = resolveChaseDate(fresh?.next_follow_up_at as string | null);
  const bump: Record<string, unknown> = {
    last_contact_at: new Date().toISOString(),
  };
  if (!chase.kept) bump.next_follow_up_at = chase.date;
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
    (["contacted", "follow_up_sent"].includes(prospect.status) &&
      (explicitFollowUp || !sameTouchWindow)) ||
    (explicitFollowUp &&
      !["replied", "qualified", "meeting_booked", "proposal_in_progress",
        "proposal_sent", "negotiation", "won"].includes(prospect.status))
  ) {
    bump.status = "follow_up_sent";
  }
  await admin.from("ge_prospects").update(bump).eq("id", prospect.id);
  await admin.from("ge_activities").insert({
    prospect_id: prospect.id,
    type: channel,
    // Says what actually happened rather than asserting a 3-day follow-up
    // that may not have been scheduled at all.
    content:
      (channel === "call"
        ? `Call made by ${memberName}`
        : `Outreach sent via ${channel} by ${memberName}`) +
      (chase.kept
        ? ` — chase kept for ${chase.date}`
        : ` — follow-up scheduled for ${chase.date}`),
    created_by: memberId,
  });
}
