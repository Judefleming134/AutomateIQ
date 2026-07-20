import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getResendClient, getFromAddress } from "@/lib/email/resend";
import { ownerNotifyRecipients } from "@/lib/email/send-booking-emails";
import { loadGrowthMetrics } from "@/lib/growth/metrics";
import { aiComplete } from "@/lib/ai/complete";
import { dublinDate, dublinWeekday } from "@/lib/growth/dates";
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
  "2026-07-10": [
    "TODAY'S PLAN, in order —",
    "① Import the new CSVs → research the top 40 (website-havers go first). Refills the pipeline for dialling + the 8am run.",
    "② Castleknock finishing touches — sharpen the voice agent (fast, urgent, books the job), run the 3 test calls, confirm Tuesday 14:00 Zoom + quote/order form ready.",
    "③ DIAL — prime business-hours work: hammer the top-scored researched list, phone-first, log every call so the follow-up auto-schedules.",
    "④ Last night's scans & catches — skim the Jarvis overnight section below and action anything flagged.",
    "⑤ Draft the weekend plan — which niches to scrape, who to chase, what to prep for next week.",
    "⑥ Before you finish — queue ~20 best emails for the next 8am run.",
  ],
  // ── Redemption weekend: OUTREACH VOLUME (research done Fri night), then
  // Mon = tweaks + dial, Tue = close Castleknock. Set by Jude Fri night.
  "2026-07-11": [
    "SATURDAY — SEND DAY. Last night you researched, queued and read the scans — today the weekend is spent SENDING. Work these:",
    "① The 8am autopilot just fired what you queued — check the SENT list below, then keep the machine fed: queue the next ~20 best emails so tomorrow's 8am run is loaded too.",
    "② DMs — work through the researched list's Instagram/Facebook/LinkedIn drafts: copy, send in the app, Mark as sent (keeps tracking + follow-ups honest). Aim for 15–20 DMs.",
    "③ Any replies (email or DM) — answer SAME DAY, replies first before new sends.",
    "④ If the drafted pile runs low, run one research batch to refill, then straight back to sending.",
    "⑤ Quick Castleknock check: 1 test call on the agent, confirm Tuesday 14:00 Zoom + quote/order form ready.",
    "END OF DAY: 20 emails queued for Sunday 8am + 15–20 DMs sent. Volume today = replies Monday.",
  ],
  "2026-07-12": [
    "SUNDAY — THE BIG WORK DAY (you slept Saturday night instead of grinding — right call; today carries the weekend). In order:",
    "① MACHINE ON FIRST (10 min): Prospects → 'Retry 27 failed' (research runs on Gemini now), then 'Research next 40' — leave the tab open and re-click each time it finishes. It works while you do everything below.",
    "② REPLIES: anything back from Friday's 23 sends — answer NOW, before any new outreach. A reply is the warmest thing you own.",
    "③ DM SESSION (the core, ~90 min): researched list, top score down. Open prospect → Studio tab → 'Send it here' strip has their profile link beside the draft: copy → tap → paste → Mark as sent. Target 15–20.",
    "④ QUEUE MONDAY'S 8AM: tick the ~20 best fresh drafts on the Jarvis autopilot and queue them.",
    "⑤ CASTLEKNOCK DRY-RUN (~30 min): full Zoom rehearsal — agent off your phone, one test call, check the job-summary email lands in Gmail, quote + order form open and ready. Time the talk track.",
    "⑥ MONDAY'S DIAL LIST: Prospects → has phone → sort by Lead score → pick the top 30. Monday is dial day; goal = ONE more booking for next week.",
    "⑦ Early night again — Monday you dial sharp and Tuesday you close.",
  ],
  "2026-07-13": [
    "MONDAY — FINAL TWEAKS + DIAL TOP PROSPECTS. Goal: ONE MORE BOOKING for next week, so Castleknock isn't the only iron in the fire:",
    "① Morning: final tweaks only (agent, demo flow, anything the weekend surfaced) — timebox it, no rabbit-holes.",
    "② Then DIAL the top-scored prospects, best scores first, tap-to-call. Log EVERY call so follow-ups auto-schedule.",
    "③ The ask on every good call: a 15-minute Zoom next week. One booked meeting today = mission accomplished.",
    "④ Answer every reply from the weekend's sends same day — those are your warmest calls.",
    "⑤ Last 30 mins: Castleknock ready-check for tomorrow (agent test, quote + order form open, Stripe/billing ready to set them up).",
  ],
  "2026-07-14": [
    "TUESDAY — CLOSE CASTLEKNOCK, 14:00. Demo → yes → SET UP THAT DAY:",
    "① Morning: final agent test, quote + order form open, billing activation ready to go.",
    "② 14:00 Zoom: demo the receptionist (widget off your phone), job-summary email lands in your inbox — show it. Walk the value, ASK FOR THE YES.",
    "③ On the yes, ON THE CALL: note their preferences for the agent, send the quote + order form, create their platform account and send the login — they activate and pay the setup fee through the dashboard.",
    "④ After the call: set up Twilio + their number, apply their agent tweaks, target live within a day or two. First customer.",
    "⑤ Then back to the phones — momentum. Any replies, answer same day.",
  ],
};

/**
 * Delivers a brief to the owner recipients. Split out so both the full
 * brief and the guaranteed-minimum fallback share one send path — the
 * promise Jude asked for is "never NOT get a brief", so every code path
 * ends here.
 */
async function deliverBrief(
  subject: string,
  bodyText: string
): Promise<{ sent: boolean; detail: string }> {
  const recipients = await ownerNotifyRecipients();
  if (recipients.length === 0)
    return { sent: false, detail: "no notify recipients configured" };
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a;max-width:640px;white-space:pre-wrap;">${escapeHtml(bodyText)}</div>`;
  const resend = getResendClient();
  const { error } = await resend.emails.send({
    from: getFromAddress(),
    to: recipients,
    subject,
    text: bodyText,
    html,
  });
  if (error) return { sent: false, detail: error.message };
  return { sent: true, detail: `to ${recipients.join(", ")}` };
}

/**
 * Jarvis's 8am email: what happened overnight, what's due, who to hit
 * first — the day's attack plan in the inbox before the app is opened.
 * The numbers and lists are deterministic (straight from the CRM); the
 * AI only writes the short battle-plan narrative on top, and if that
 * call fails the brief still sends without it.
 *
 * WEEKENDS (Sat/Sun Irish time) get a lighter brief: only what changed
 * and the overnight catches + fixes from the nightly routine — no needle-
 * mover push, no full pipeline dump, so the weekend inbox stays calm.
 *
 * GUARANTEE: a brief always goes out. If the CRM data layer fails entirely,
 * a minimal "here's your nudge" brief is sent instead of nothing. Never
 * throws — the cron dispatcher records the returned summary either way.
 */
export async function sendJarvisMorningBrief(): Promise<{
  sent: boolean;
  detail: string;
}> {
  const today = dublinDate();
  const wd = dublinWeekday();
  const isWeekend = wd === 0 || wd === 6;
  try {
    const admin = createAdminClient();
    const activeFilter = `(${CLOSED_STATUSES.map((s) => `"${s}"`).join(",")})`;
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [
      metrics,
      week,
      { data: due, count: dueCount },
      { data: ready, count: readyCount },
      { data: overnightReplies },
      { data: meetingsToday },
    ] = await Promise.all([
      loadGrowthMetrics(admin, null),
      loadGrowthMetrics(admin, 7),
      admin
        .from("ge_prospects")
        // count: the TRUE total, not the 15-row display cap — the brief was
        // reporting "15 due" whenever the real number was higher.
        .select("company, contact_name, status, lead_score, next_follow_up_at, phone", { count: "exact" })
        .lte("next_follow_up_at", today)
        // Same 7-day window as the autopilot: chases older than a week are
        // "gone cold" and live in their own dashboard section, so the brief's
        // due list stays a today-list, not a wall of ancient follow-ups.
        .gte("next_follow_up_at", dublinDate(-7))
        .not("status", "in", activeFilter)
        .order("next_follow_up_at", { ascending: true })
        .limit(15),
      admin
        .from("ge_prospects")
        .select("company, contact_name, industry, lead_score, phone, email", { count: "exact" })
        .in("status", ["research_complete", "outreach_ready"])
        // nullsFirst:false so unscored leads don't outrank your best ones —
        // Postgres sorts NULLS FIRST on DESC by default, which would put
        // score-less leads at the top of this "hit these first" list.
        .order("lead_score", { ascending: false, nullsFirst: false })
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
        .select("scheduled_at, strategy_booking_id, ge_prospects(company)")
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

    // Suggested reply drafts the engine wrote for incoming replies — so the
    // brief can tell Jude the responses are already waiting, just review + send.
    const { count: replyDrafts24h } = await admin
      .from("ge_messages")
      .select("id", { count: "exact", head: true })
      .eq("direction", "outbound")
      .eq("purpose", "reply")
      .eq("status", "draft")
      .gte("created_at", since24h);

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

    // ── Jarvis Needle-Mover Score (weekdays only) ──────────────────────
    // One number for "did yesterday move the needle?" — weighted toward the
    // actions that actually win customers (calls, replies, meetings) over
    // raw volume (leads added), scored against the last 7 days' daily
    // average so it reads as progress "vs recent days". Skipped at weekends:
    // the weekend brief is a calm changelog, not a productivity push.
    let nmScoreBlock = "";
    if (!isWeekend) {
      const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const [
        { count: nmSentY }, { count: nmCallsY }, { count: nmReplyY },
        { count: nmResY }, { count: nmMeetY }, { count: nmLeadY },
        { count: nmSentW }, { count: nmCallsW }, { count: nmReplyW },
        { count: nmResW }, { count: nmMeetW }, { count: nmLeadW },
      ] = await Promise.all([
        admin.from("ge_messages").select("id", { count: "exact", head: true }).eq("direction", "outbound").eq("status", "sent").gte("sent_at", since24h),
        admin.from("ge_activities").select("id", { count: "exact", head: true }).eq("type", "call").gte("created_at", since24h),
        admin.from("ge_messages").select("id", { count: "exact", head: true }).eq("direction", "inbound").gte("created_at", since24h),
        admin.from("ge_research").select("prospect_id", { count: "exact", head: true }).gte("updated_at", since24h),
        admin.from("ge_meetings").select("id", { count: "exact", head: true }).gte("created_at", since24h),
        admin.from("ge_prospects").select("id", { count: "exact", head: true }).gte("created_at", since24h),
        admin.from("ge_messages").select("id", { count: "exact", head: true }).eq("direction", "outbound").eq("status", "sent").gte("sent_at", since7d),
        admin.from("ge_activities").select("id", { count: "exact", head: true }).eq("type", "call").gte("created_at", since7d),
        admin.from("ge_messages").select("id", { count: "exact", head: true }).eq("direction", "inbound").gte("created_at", since7d),
        admin.from("ge_research").select("prospect_id", { count: "exact", head: true }).gte("updated_at", since7d),
        admin.from("ge_meetings").select("id", { count: "exact", head: true }).gte("created_at", since7d),
        admin.from("ge_prospects").select("id", { count: "exact", head: true }).gte("created_at", since7d),
      ]);
      const nmPoints = (s: number, c: number, r: number, rs: number, m: number, l: number) =>
        s * 2 + c * 3 + r * 6 + m * 25 + rs * 1 + l * 0.5;
      const nmYest = nmPoints(nmSentY ?? 0, nmCallsY ?? 0, nmReplyY ?? 0, nmResY ?? 0, nmMeetY ?? 0, nmLeadY ?? 0);
      const nmDailyAvg = nmPoints(nmSentW ?? 0, nmCallsW ?? 0, nmReplyW ?? 0, nmResW ?? 0, nmMeetW ?? 0, nmLeadW ?? 0) / 7;
      const nmScore =
        nmDailyAvg > 0.5
          ? Math.max(0, Math.min(100, Math.round((50 * nmYest) / nmDailyAvg)))
          : Math.min(100, Math.round(nmYest * 3)); // fresh account: absolute-ish
      const nmTier =
        nmScore >= 80 ? "🔥 On fire" : nmScore >= 60 ? "💪 Strong" : nmScore >= 40 ? "➖ Steady" : nmScore >= 20 ? "🐢 Slow start" : "😴 Quiet day";
      const nmVerdict =
        nmDailyAvg <= 0.5
          ? "just getting going — build the habit today"
          : nmYest >= nmDailyAvg * 1.2
            ? "above your recent daily average — momentum's building, keep pushing"
            : nmYest >= nmDailyAvg * 0.8
              ? "right around your recent average — hold the line and push a bit harder"
              : "below your recent days — today's the day to move it: dial and send early";
      nmScoreBlock =
        `🎯 JARVIS NEEDLE-MOVER SCORE: ${nmScore}/100 — ${nmTier}\n` +
        `${nmVerdict}\n` +
        `Yesterday: ${nmSentY ?? 0} sent · ${nmCallsY ?? 0} calls · ${nmReplyY ?? 0} replies · ${nmMeetY ?? 0} meetings · ${nmResY ?? 0} researched · ${nmLeadY ?? 0} leads added`;
    }

    // What changed over the weekend/overnight — the core of the weekend brief.
    const { count: leadsAdded24h } = await admin
      .from("ge_prospects")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since24h);

    // Gone-cold tally (7+ days overdue, no longer auto-chased) — one line so
    // the pile stays visible without flooding the due list.
    const { count: goneColdCount } = await admin
      .from("ge_prospects")
      .select("id", { count: "exact", head: true })
      .lt("next_follow_up_at", dublinDate(-7))
      .not("status", "in", activeFilter);

    const statusLabel = (s: string) =>
      PROSPECT_STATUS_META[s as ProspectStatus]?.label ?? s;
    const companyOf = (row: { ge_prospects: unknown }) =>
      (row.ge_prospects as { company?: string } | null)?.company ?? "unknown";

    // Many leads are imported with just a company name, so guard the contact
    // parens — otherwise the brief prints a literal "(null)" beside them.
    const dueLines = (due ?? []).map(
      (p) =>
        `• ${p.company}${p.contact_name ? ` (${p.contact_name})` : ""} — ${statusLabel(p.status)}, score ${p.lead_score ?? 0}, due ${p.next_follow_up_at}${p.phone ? `, ${p.phone}` : ""}`
    );
    const readyLines = (ready ?? []).map(
      (p) =>
        `• ${p.company}${p.contact_name ? ` (${p.contact_name})` : ""} — ${p.industry || "?"}, score ${p.lead_score ?? 0} — drafts ready${p.phone ? `, ${p.phone}` : ""}`
    );
    // True totals vs the display caps (15 due / 10 ready shown): the header
    // and subject must report the REAL number, with a "…and N more" tail.
    const dueTotal = dueCount ?? dueLines.length;
    const readyTotal = readyCount ?? readyLines.length;
    const dueMore =
      dueTotal > dueLines.length
        ? `\n• …and ${dueTotal - dueLines.length} more — full list on the dashboard.`
        : "";
    const readyMore =
      readyTotal > readyLines.length
        ? `\n• …and ${readyTotal - readyLines.length} more researched and waiting.`
        : "";
    const replyLines = (overnightReplies ?? []).map(
      (m) =>
        `• ${companyOf(m)} via ${m.channel}${m.sentiment ? ` (${m.sentiment})` : ""}: "${String(m.body ?? "").slice(0, 140)}"`
    );
    const meetingLines = (meetingsToday ?? []).map(
      // Manually recorded meetings are stored as real UTC instants, so render
      // them in Dublin. Public-booking slots are labelled by their UTC
      // wall-clock (the customer's confirmation shows 14:00Z as "2:00pm"), so
      // render synced bookings in UTC to match what the customer was told —
      // otherwise the brief shows the session an hour late in summer.
      (m) =>
        `• ${new Date(String(m.scheduled_at)).toLocaleTimeString("en-IE", {
          timeZone: (m as { strategy_booking_id?: string | null }).strategy_booking_id
            ? "UTC"
            : "Europe/Dublin",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })} — ${companyOf(m)}`
    );

    // The narrative on top — best-effort, the brief never depends on it.
    // Weekdays only: the weekend brief stays a quiet changelog.
    let plan = "";
    if (!isWeekend) try {
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
            `Follow-ups due (${dueTotal}, top ${dueLines.length} listed):\n${dueLines.join("\n") || "none"}`,
            `Ready to send (${readyTotal}, top ${readyLines.length} listed):\n${readyLines.join("\n") || "none"}`,
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

    // When the engine has pre-written responses to incoming replies, say so —
    // the answers are already waiting in the inbox, just review and send.
    const replyDraftNote =
      (replyDrafts24h ?? 0) > 0
        ? `\n✍️ ${replyDrafts24h} suggested repl${replyDrafts24h === 1 ? "y is" : "ies are"} already drafted for you — review & send in the inbox.`
        : "";

    const reminders = DATED_REMINDERS[today] ?? [];

    // Blocks shared by both shapes: the overnight catches + fixes.
    const deliveryBlock = deliveryLines.length
      ? `📬 DELIVERY ISSUES (${deliveryLines.length})\n${deliveryLines.join("\n")}`
      : "";
    const sentBlock = (sentToday ?? []).length
      ? `📤 SENT THIS MORNING (${(sentToday ?? []).length})\n${(sentToday ?? [])
          .map((m) => {
            const company =
              (m.ge_prospects as { company?: string } | null)?.company ?? "unknown";
            return `• ${company} — "${m.subject ?? ""}"`;
          })
          .join("\n")}`
      : "";
    const nightlyBlock = nightlyLines.length
      ? `🔧 JARVIS'S OVERNIGHT ROUTINE — CATCHES & FIXES (${nightlyLines.length})\n${nightlyLines.join("\n")}`
      : "";

    let bodyText: string;
    let subject: string;

    if (isWeekend) {
      // Weekend: a calm changelog — what changed, overnight catches, and the
      // fixes the nightly routine applied. No pipeline dump, no needle-mover.
      const changedLine =
        `📈 WHAT CHANGED\n• ${leadsAdded24h ?? 0} new lead${(leadsAdded24h ?? 0) === 1 ? "" : "s"} added` +
        `${(sentToday ?? []).length ? ` · ${(sentToday ?? []).length} email${(sentToday ?? []).length === 1 ? "" : "s"} sent this morning` : ""}` +
        `${replyLines.length ? ` · ${replyLines.length} new repl${replyLines.length === 1 ? "y" : "ies"}` : ""}`;
      bodyText = [
        `🌤️ Weekend brief — ${today}. Lighter one: just what changed and what Jarvis caught & fixed overnight. Enjoy the weekend.`,
        reminders.length
          ? `⏰ REMINDERS\n${reminders.map((r) => `• ${r}`).join("\n")}`
          : "",
        changedLine,
        nightlyBlock,
        deliveryBlock,
        replyLines.length
          ? section(`OVERNIGHT REPLIES (${replyLines.length})`, replyLines, "") + replyDraftNote
          : "",
        meetingLines.length
          ? section(`MEETINGS TODAY (${meetingLines.length})`, meetingLines, "")
          : "",
        sentBlock,
        "Open Jarvis: https://automateiq.ie/growth/jarvis",
      ]
        .filter(Boolean)
        .join("\n\n");
      subject = `Jarvis weekend brief — ${today}: ${leadsAdded24h ?? 0} added, ${nightlyLines.length} overnight fixes, ${replyLines.length} replies`;
    } else {
      // Weekday: the full attack plan.
      bodyText = [
        plan,
        nmScoreBlock,
        reminders.length
          ? `⏰ REMINDERS FOR TODAY\n${reminders.map((r) => `• ${r}`).join("\n")}`
          : "",
        deliveryBlock,
        sentBlock,
        nightlyBlock,
        section(`OVERNIGHT REPLIES (${replyLines.length})`, replyLines, "No new replies — keep the volume up.") + replyDraftNote,
        section(`MEETINGS TODAY (${meetingLines.length})`, meetingLines, "None booked today."),
        section(`FOLLOW-UPS DUE (${dueTotal})`, dueLines, "Nothing due — pipeline is current.") +
          dueMore +
          ((goneColdCount ?? 0) > 0
            ? `\n🧊 ${goneColdCount} gone cold (7+ days overdue) — parked on the dashboard's Gone-cold section, no longer auto-chased.`
            : ""),
        section(`READY TO SEND (${readyTotal})`, readyLines, "Nothing researched and waiting — import or research leads.") +
          readyMore,
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
      subject = `Jarvis morning brief — ${today}: ${replyLines.length} replies, ${dueTotal} due, ${readyTotal} ready to send`;
    }

    const { sent, detail } = await deliverBrief(subject, bodyText);
    if (!sent) return { sent, detail };
    return {
      sent: true,
      detail: `${isWeekend ? "weekend " : ""}${detail} (${replyLines.length} replies, ${nightlyLines.length} overnight fixes)`,
    };
  } catch (err) {
    // GUARANTEE: the data layer blew up, but Jude still gets a brief. Send a
    // minimal nudge rather than nothing — "never NOT get a brief".
    console.error("Jarvis morning brief failed — sending minimal fallback:", err);
    const fallback = [
      `${isWeekend ? "🌤️ Weekend brief" : "☀️ Morning brief"} — ${today}`,
      "Jarvis couldn't assemble the full brief this morning (a data lookup hiccuped), but here's your nudge so the day still starts with a plan:",
      "• Open Jarvis and eyeball the pipeline — replies first, then due follow-ups, then fresh sends.",
      "• If anything looks off, tell Claude and it'll dig in.",
      "Open Jarvis: https://automateiq.ie/growth/jarvis",
    ].join("\n\n");
    try {
      const { sent, detail } = await deliverBrief(
        `Jarvis brief — ${today} (lite)`,
        fallback
      );
      return sent
        ? { sent: true, detail: `minimal fallback sent — ${detail}` }
        : { sent: false, detail: `fallback failed: ${detail}` };
    } catch (err2) {
      return {
        sent: false,
        detail: err2 instanceof Error ? err2.message : "unknown error",
      };
    }
  }
}
