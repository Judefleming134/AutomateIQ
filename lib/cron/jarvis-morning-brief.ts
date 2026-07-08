import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getResendClient, getFromAddress } from "@/lib/email/resend";
import { ownerNotifyRecipients } from "@/lib/email/send-booking-emails";
import { loadGrowthMetrics } from "@/lib/growth/metrics";
import { aiComplete } from "@/lib/ai/complete";
import { dublinDate } from "@/lib/growth/dates";
import {
  CLOSED_STATUSES,
  PROSPECT_STATUS_META,
  type ProspectStatus,
} from "@/lib/growth/constants";

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Dated one-off reminders Jude asks for ("remind me in the morning to…").
 * Keyed by Dublin date; shown in that morning's brief then naturally
 * expires. Add entries via Claude — a table is overkill until these are
 * created from inside the app.
 */
const DATED_REMINDERS: Record<string, string[]> = {
  "2026-07-08": [
    "Scrape a NEW NICHE today: blinds installers (Google Maps, same drill as the cleaners) — paste the list to Claude to clean and format.",
  ],
};

/**
 * Jarvis's 8am email: what happened overnight, what's due, who to hit
 * first — the day's attack plan in the inbox before the app is opened.
 * The numbers and lists are deterministic (straight from the CRM); the
 * AI only writes the short battle-plan narrative on top, and if that
 * call fails the brief still sends without it. Never throws: the cron
 * dispatcher records the returned summary either way.
 */
export async function sendJarvisMorningBrief(): Promise<{
  sent: boolean;
  detail: string;
}> {
  try {
    const admin = createAdminClient();
    const today = dublinDate();
    const activeFilter = `(${CLOSED_STATUSES.map((s) => `"${s}"`).join(",")})`;
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [
      metrics,
      week,
      { data: due },
      { data: ready },
      { data: overnightReplies },
      { data: meetingsToday },
    ] = await Promise.all([
      loadGrowthMetrics(admin, null),
      loadGrowthMetrics(admin, 7),
      admin
        .from("ge_prospects")
        .select("company, contact_name, status, lead_score, next_follow_up_at, phone")
        .lte("next_follow_up_at", today)
        .not("status", "in", activeFilter)
        .order("next_follow_up_at", { ascending: true })
        .limit(15),
      admin
        .from("ge_prospects")
        .select("company, contact_name, industry, lead_score, phone, email")
        .in("status", ["research_complete", "outreach_ready"])
        .order("lead_score", { ascending: false })
        .limit(10),
      admin
        .from("ge_messages")
        .select("channel, body, sentiment, created_at, ge_prospects(company)")
        .eq("direction", "inbound")
        .gte("created_at", since24h)
        .order("created_at", { ascending: false })
        .limit(10),
      admin
        .from("ge_meetings")
        .select("scheduled_at, ge_prospects(company)")
        .eq("status", "booked")
        .gte("scheduled_at", `${today}T00:00:00`)
        .lte("scheduled_at", `${today}T23:59:59`)
        .order("scheduled_at")
        .limit(10),
    ]);

    // What the 8am autopilot just sent (this dispatch runs sends first).
    const { data: sentToday } = await admin
      .from("ge_messages")
      .select("subject, sent_at, ge_prospects(company)")
      .eq("channel", "email")
      .eq("direction", "outbound")
      .eq("status", "sent")
      .gte("sent_at", `${today}T00:00:00`)
      .order("sent_at", { ascending: false })
      .limit(35);

    // Send age matters: fresh outreach with no replies is pending, not
    // failing — give the narrative the data to judge that correctly.
    const { count: sent24h } = await admin
      .from("ge_messages")
      .select("id", { count: "exact", head: true })
      .eq("direction", "outbound")
      .eq("status", "sent")
      .gte("sent_at", since24h);

    // Delivery trouble reported by the email provider's webhooks (bounces,
    // spam complaints, delays) — ground truth on whether sends arrived.
    const { data: deliveryActs } = await admin
      .from("ge_activities")
      .select("content, ge_prospects(company)")
      .ilike("content", "Email delivery:%")
      .not("content", "ilike", "%delivered to%")
      .gte("created_at", since24h)
      .order("created_at", { ascending: false })
      .limit(15);
    const deliveryLines = (deliveryActs ?? []).map((a) => {
      const company =
        (a.ge_prospects as { company?: string } | null)?.company ?? "unknown";
      return `• ${company} — ${String(a.content).replace(/^Email delivery:\s*/i, "")}`;
    });

    // What Jarvis's 10pm nightly routine did while Jude slept.
    const { data: nightlyActs } = await admin
      .from("ge_activities")
      .select("content, ge_prospects(company)")
      .ilike("content", "Jarvis nightly:%")
      .gte("created_at", since24h)
      .order("created_at", { ascending: false })
      .limit(20);
    const nightlyLines = (nightlyActs ?? []).map((a) => {
      const company =
        (a.ge_prospects as { company?: string } | null)?.company ?? "unknown";
      return `• ${company} — ${String(a.content).replace(/^Jarvis nightly:\s*/i, "")}`;
    });

    const statusLabel = (s: string) =>
      PROSPECT_STATUS_META[s as ProspectStatus]?.label ?? s;
    const companyOf = (row: { ge_prospects: unknown }) =>
      (row.ge_prospects as { company?: string } | null)?.company ?? "unknown";

    const dueLines = (due ?? []).map(
      (p) =>
        `• ${p.company} (${p.contact_name}) — ${statusLabel(p.status)}, score ${p.lead_score ?? 0}, due ${p.next_follow_up_at}${p.phone ? `, ${p.phone}` : ""}`
    );
    const readyLines = (ready ?? []).map(
      (p) =>
        `• ${p.company} (${p.contact_name}) — ${p.industry || "?"}, score ${p.lead_score ?? 0} — drafts ready${p.phone ? `, ${p.phone}` : ""}`
    );
    const replyLines = (overnightReplies ?? []).map(
      (m) =>
        `• ${companyOf(m)} via ${m.channel}${m.sentiment ? ` (${m.sentiment})` : ""}: "${String(m.body ?? "").slice(0, 140)}"`
    );
    const meetingLines = (meetingsToday ?? []).map(
      (m) => `• ${String(m.scheduled_at).slice(11, 16)} — ${companyOf(m)}`
    );

    // The narrative on top — best-effort, the brief never depends on it.
    let plan = "";
    try {
      plan = (
        await aiComplete(
          [
            "You are Jarvis, the sales copilot for AutomateIQ (Irish AI-automation agency, solo founder Jude).",
            "Write the 4-6 sentence opening of his morning brief: direct, a little dry, zero fluff.",
            "Reference only the companies and numbers provided. Order the morning: replies first, then due follow-ups, then fresh sends. If a day looks empty, say what to do about it (add leads, research, call).",
            "JUDGE REPLY RATES AGAINST SEND AGE, not window totals: outreach under 48 hours old with no reply is PENDING, not a failing trend — never call a reply rate a problem when most sends are that fresh. Cold email replies arrive over 24-72h; DMs slower.",
          ].join("\n"),
          [
            `Date: ${today}`,
            `Pipeline: €${metrics.pipelineValue} across ${metrics.prospectsTotal} prospects; reply rate ${metrics.replyRate}%; meetings ${metrics.meetingsBooked}; won ${metrics.won}.`,
            `Last 7 days: ${week.outreachSent} sent, ${week.replies} replies, ${week.meetingsBooked} meetings — of which ${sent24h ?? 0} sends are under 24h old (too fresh to expect replies).`,
            `Emails the autopilot just sent this morning: ${(sentToday ?? []).length}.`,
            `Overnight replies (${replyLines.length}):\n${replyLines.join("\n") || "none"}`,
            `Follow-ups due (${dueLines.length}):\n${dueLines.join("\n") || "none"}`,
            `Ready to send (${readyLines.length}):\n${readyLines.join("\n") || "none"}`,
            `Meetings today (${meetingLines.length}):\n${meetingLines.join("\n") || "none"}`,
          ].join("\n\n"),
          700,
          { effort: "low" }
        )
      ).trim();
    } catch (err) {
      console.error("Jarvis brief narrative failed (brief still sends):", err);
    }

    const section = (title: string, lines: string[], empty: string) =>
      `${title}\n${lines.length ? lines.join("\n") : `• ${empty}`}`;

    const reminders = DATED_REMINDERS[today] ?? [];

    const bodyText = [
      plan,
      reminders.length
        ? `⏰ REMINDERS FOR TODAY\n${reminders.map((r) => `• ${r}`).join("\n")}`
        : "",
      deliveryLines.length
        ? `📬 DELIVERY ISSUES (${deliveryLines.length})\n${deliveryLines.join("\n")}`
        : "",
      (sentToday ?? []).length
        ? `📤 SENT THIS MORNING (${(sentToday ?? []).length})\n${(sentToday ?? [])
            .map((m) => {
              const company =
                (m.ge_prospects as { company?: string } | null)?.company ?? "unknown";
              return `• ${company} — "${m.subject ?? ""}"`;
            })
            .join("\n")}`
        : "",
      nightlyLines.length
        ? `🔧 JARVIS'S OVERNIGHT ROUTINE (${nightlyLines.length})\n${nightlyLines.join("\n")}`
        : "",
      section(`OVERNIGHT REPLIES (${replyLines.length})`, replyLines, "No new replies — keep the volume up."),
      section(`MEETINGS TODAY (${meetingLines.length})`, meetingLines, "None booked today."),
      section(`FOLLOW-UPS DUE (${dueLines.length})`, dueLines, "Nothing due — pipeline is current."),
      section(`READY TO SEND (${readyLines.length})`, readyLines, "Nothing researched and waiting — import or research leads."),
      [
        "THE NUMBERS",
        `• Pipeline value: €${metrics.pipelineValue.toLocaleString("en-IE")}`,
        `• Reply rate: ${metrics.replyRate}% · Meetings: ${metrics.meetingsBooked} · Won: ${metrics.won}`,
        `• Last 7 days: ${week.outreachSent} sent, ${week.replies} replies, ${week.leadsAdded} leads added`,
      ].join("\n"),
      "Open Jarvis: https://automateiq.ie/growth/jarvis",
    ]
      .filter(Boolean)
      .join("\n\n");

    const recipients = await ownerNotifyRecipients();
    if (recipients.length === 0)
      return { sent: false, detail: "no notify recipients configured" };

    const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a;max-width:640px;white-space:pre-wrap;">${escapeHtml(bodyText)}</div>`;

    const resend = getResendClient();
    const { error } = await resend.emails.send({
      from: getFromAddress(),
      to: recipients,
      subject: `Jarvis morning brief — ${today}: ${replyLines.length} replies, ${dueLines.length} due, ${readyLines.length} ready to send`,
      text: bodyText,
      html,
    });
    if (error) return { sent: false, detail: error.message };
    return {
      sent: true,
      detail: `to ${recipients.join(", ")} (${replyLines.length} replies, ${dueLines.length} due, ${readyLines.length} ready)`,
    };
  } catch (err) {
    console.error("Jarvis morning brief failed:", err);
    return {
      sent: false,
      detail: err instanceof Error ? err.message : "unknown error",
    };
  }
}
