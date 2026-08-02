import Link from "next/link";
import {
  Users,
  Send,
  MessageSquare,
  CalendarCheck,
  TrendingUp,
  Euro,
  Sparkles,
  Flame,
  AlarmClock,
  FileText,
} from "lucide-react";
import { requireGrowth } from "@/lib/growth/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { selectAllRowsByIds } from "@/lib/growth/db";
import { loadGrowthMetrics } from "@/lib/growth/metrics";
import { splitMeetings } from "@/lib/growth/meeting-order";
import { isAwaiting } from "@/lib/growth/awaiting";
import { StatCard } from "@/components/portal/stat-card";
import { ActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/admin/submit-button";
import {
  CHANNEL_META,
  CLOSED_STATUSES,
  CONTACTED_ACTIVE_STATUSES,
  PROSPECT_STATUS_META,
  type Channel,
  type ProspectStatus,
} from "@/lib/growth/constants";
import { dublinDate, dublinHour } from "@/lib/growth/dates";
import { quickResearch } from "./prospects/actions";
import { sendDueFollowups } from "./actions";

// Quick research runs a full AI research pass inside this route's actions.
export const maxDuration = 60;

type ProspectRow = {
  id: string;
  company: string;
  contact_name: string;
  status: string;
  // Nullable: a replied/contacted lead that was added manually and never
  // researched has no score — rendering must not print "null/100".
  lead_score: number | null;
  next_follow_up_at: string | null;
  last_contact_at: string | null;
};

function ProspectList({ rows, dateField }: { rows: ProspectRow[]; dateField?: "follow_up" | "last_contact" }) {
  return (
    <div className="table-wrap">
      <table>
        <tbody>
          {rows.map((p) => {
            const meta = PROSPECT_STATUS_META[p.status as ProspectStatus];
            return (
              <tr key={p.id}>
                <td>
                  <Link href={`/growth/prospects/${p.id}`}>
                    <strong>{p.company}</strong>
                  </Link>
                  <div style={{ color: "var(--faint)", fontSize: 12 }}>{p.contact_name}</div>
                </td>
                <td>
                  <span className={`badge ${meta?.badge ?? "badge-gray"}`}>
                    {meta?.label ?? p.status}
                  </span>
                </td>
                <td style={{ fontSize: 13 }}>
                  {dateField === "follow_up"
                    ? p.next_follow_up_at
                    : dateField === "last_contact"
                      ? (p.last_contact_at?.slice(0, 10) ?? "—")
                      : p.lead_score != null && p.lead_score > 0
                        ? `${p.lead_score}/100`
                        : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default async function GrowthDashboardPage() {
  const { member } = await requireGrowth();
  const admin = createAdminClient();

  const today = dublinDate();
  const activeFilter = `(${CLOSED_STATUSES.map((s) => `"${s}"`).join(",")})`;

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Gone cold: follow-ups more than 7 days overdue (list + true count). These
  // don't depend on the main batch, so kick them off HERE and await after — a
  // second `await Promise.all` below would run them as a wasted extra round-trip
  // on every dashboard load. Parked out of the live lists and the autopilot.
  const goneColdQuery = Promise.all([
    admin
      .from("ge_prospects")
      .select("id, company, contact_name, status, lead_score, next_follow_up_at, last_contact_at")
      .lt("next_follow_up_at", dublinDate(-7))
      .not("status", "in", activeFilter)
      .order("next_follow_up_at", { ascending: true })
      .limit(10),
    admin
      .from("ge_prospects")
      .select("id", { count: "exact", head: true })
      .lt("next_follow_up_at", dublinDate(-7))
      .not("status", "in", activeFilter),
  ]);

  const [
    metrics,
    { data: readyToSend, count: readyStatusCount },
    { data: dueToday },
    { data: overdue },
    { data: hot },
    { data: recentContacted },
    { data: upcomingMeetings },
    { data: queuedEmails },
    { data: nightly },
    { count: dueTodayCount },
    { count: overdueCount },
    { data: inboundRows },
    { count: unscheduledCount },
    { count: totalLeads },
    { count: researchedLeads },
    { count: leadsWithEmail },
    { count: emailDrafts },
    { count: everContacted },
  ] = await Promise.all([
    // withSolutions:false — the dashboard never renders topSolutions, and this
    // is his home screen. Skips the full recommendation JSONB per researched
    // prospect for numbers it doesn't use.
    loadGrowthMetrics(admin, 30, { withSolutions: false }),
    admin
      .from("ge_prospects")
      // count: the TRUE ready total — the list caps at 50, and once the
      // overnight engine researches in bulk the heading must not undercount.
      .select("id, company, contact_name, industry, lead_score, status", { count: "exact" })
      .in("status", ["research_complete", "outreach_ready"])
      // nullsFirst:false so unscored leads don't outrank scored ones —
      // Postgres sorts NULLS FIRST on DESC by default, which would float
      // score-less prospects to the top of these "best first" lists.
      .order("lead_score", { ascending: false, nullsFirst: false })
      .limit(50),
    admin
      .from("ge_prospects")
      .select("id, company, contact_name, status, lead_score, next_follow_up_at, last_contact_at")
      .eq("next_follow_up_at", today)
      .not("status", "in", activeFilter)
      // nullsFirst:false so unscored leads don't outrank scored ones —
      // Postgres sorts NULLS FIRST on DESC by default, which would float
      // score-less prospects to the top of these "best first" lists.
      .order("lead_score", { ascending: false, nullsFirst: false })
      .limit(10),
    admin
      .from("ge_prospects")
      .select("id, company, contact_name, status, lead_score, next_follow_up_at, last_contact_at")
      .lt("next_follow_up_at", today)
      // Live overdue = up to 7 days late (still auto-chased). Older than that
      // has gone cold and lives in its own section below, so this list isn't
      // a permanent wall of ancient follow-ups.
      .gte("next_follow_up_at", dublinDate(-7))
      .not("status", "in", activeFilter)
      .order("next_follow_up_at", { ascending: true })
      .limit(10),
    admin
      .from("ge_prospects")
      .select("id, company, contact_name, status, lead_score, next_follow_up_at, last_contact_at")
      // The live working set: everyone replied or actively being worked
      // (contacted / chasing) plus the committed later stages. Ranked by stage
      // then score below and capped at 20, so it's the leads worth working now
      // — and it auto-refills as deals close and drop out.
      .in("status", ["replied", "contacted", "follow_up_sent", "qualified", "meeting_booked", "proposal_in_progress", "proposal_sent", "negotiation"])
      // Pre-order by score, but the real hot ranking is by pipeline STAGE
      // (done in JS below). Fetch a wider slice than the 20 shown so a
      // late-stage lead with a modest cold score still makes the cut before
      // the stage sort runs. nullsFirst:false so unscored leads don't float up.
      .order("lead_score", { ascending: false, nullsFirst: false })
      .limit(120),
    admin
      .from("ge_prospects")
      .select("id, company, contact_name, status, lead_score, next_follow_up_at, last_contact_at")
      .not("last_contact_at", "is", null)
      .not("status", "in", activeFilter)
      .order("last_contact_at", { ascending: false })
      .limit(6),
    admin
      .from("ge_meetings")
      .select("id, scheduled_at, status, prospect_id, strategy_booking_id, ge_prospects(company)")
      .eq("status", "booked")
      // Deliberately a WIDE, over-fetched window rather than the exact one.
      //
      // scheduled_at holds two different things: a booking-page slot stores
      // Irish wall-clock AS UTC (a 14:00 session is stored 14:00Z), while a
      // manually recorded meeting stores a true instant. Comparing both
      // against real UTC now is an hour wrong for bookings in summer — a
      // session already underway kept sitting in "Upcoming", and a booking
      // could outrank a manual meeting that was genuinely sooner.
      //
      // So: fetch generously either side, then filter and order in memory
      // with the shared helper that knows about both frames. 12 hours covers
      // the 1-hour skew many times over.
      .gte("scheduled_at", new Date(Date.now() - 12 * 3600 * 1000).toISOString())
      .order("scheduled_at", { ascending: true })
      .limit(24),
    // Prospects whose first-touch email is already queued for the 8am run —
    // they're handled, so they shouldn't also appear as "ready to send".
    admin
      .from("ge_messages")
      .select("prospect_id")
      .eq("channel", "email")
      .eq("direction", "outbound")
      .eq("status", "queued"),
    // What the engine did on its own in the last 24h — so the automation is
    // visible and trusted, not a black box.
    admin
      .from("ge_activities")
      .select("content")
      .ilike("content", "Jarvis nightly:%")
      .gte("created_at", since24h)
      .limit(400),
    // True totals for the follow-up headings — the lists above cap at 10, so
    // on a busy day the heading count must come from a real count, or Jude
    // thinks he's cleared his chases when a dozen more sit below the fold.
    admin
      .from("ge_prospects")
      .select("id", { count: "exact", head: true })
      .eq("next_follow_up_at", today)
      .not("status", "in", activeFilter),
    admin
      .from("ge_prospects")
      .select("id", { count: "exact", head: true })
      .lt("next_follow_up_at", today)
      .gte("next_follow_up_at", dublinDate(-7))
      .not("status", "in", activeFilter),
    // Every reply ever received, newest first — the raw material for "who is
    // waiting on ME". Inbound is a small fraction of message volume (thousands
    // of sends produce dozens of replies), so this stays cheap.
    admin
      .from("ge_messages")
      .select("prospect_id, body, channel, created_at")
      .eq("direction", "inbound")
      .order("created_at", { ascending: false })
      .limit(400),
    // Prospects you've ALREADY spoken to that have nothing scheduled. These
    // are invisible to every chase surface in the engine, so "Nothing overdue
    // — clean pipeline" was reading as praise while they quietly sat there.
    // Head count only: the list itself lives one click away.
    admin
      .from("ge_prospects")
      .select("id", { count: "exact", head: true })
      .in("status", CONTACTED_ACTIVE_STATUSES)
      .is("next_follow_up_at", null),
    // ── The funnel. Five head counts, no rows returned. ──────────────────
    // "757 leads and two replies" is not a pitch problem until you know how
    // many of the 757 were ever actually emailed. Each of these is one stage,
    // so the drop-off between them shows where the pipeline is really stuck.
    admin
      .from("ge_prospects")
      .select("id", { count: "exact", head: true })
      .not("status", "in", activeFilter),
    admin.from("ge_research").select("prospect_id", { count: "exact", head: true }),
    admin
      .from("ge_prospects")
      .select("id", { count: "exact", head: true })
      .not("email", "is", null)
      .not("status", "in", activeFilter),
    admin
      .from("ge_messages")
      .select("id", { count: "exact", head: true })
      .eq("channel", "email")
      .eq("direction", "outbound")
      .in("status", ["draft", "queued"]),
    admin
      .from("ge_prospects")
      .select("id", { count: "exact", head: true })
      .not("last_contact_at", "is", null),
  ]);

  // Issued above alongside the main batch so both waves run concurrently.
  const [{ data: goneCold }, { count: goneColdCount }] = await goneColdQuery;

  // The genuinely upcoming ones, resolved from the over-fetched window.
  //
  // splitMeetings compares a booking-page slot against IRISH wall-clock now
  // and a manually recorded meeting against real now, then orders both by
  // their real instant — so a session already underway drops off, and a
  // booking can no longer outrank a manual meeting that is actually sooner.
  // Same helper the meetings page uses, so the dashboard panel and the "All →"
  // page it links to can never disagree about what is next.
  const nextMeetings = splitMeetings(
    (upcomingMeetings ?? []) as unknown as {
      id: string;
      scheduled_at: string;
      strategy_booking_id: string | null;
      status: string;
      prospect_id: string;
      ge_prospects: unknown;
    }[]
  ).upcoming.slice(0, 6);

  // WHO IS WAITING ON A REPLY. The dashboard tracked chases due, overdue, gone
  // cold, hot leads and meetings — but nowhere did it show a prospect who
  // actually WROTE BACK and hasn't been answered. That's the most expensive
  // miss in the engine: they raised their hand and got silence. It was only
  // visible by opening the Inbox tab, so a reply from Friday could sit all
  // weekend behind a green pipeline. `status: "replied"` doesn't cover it —
  // that stage never clears once Jude answers.
  //
  // Same "who spoke last" rule as the inbox (app/growth/(app)/inbox/page.tsx):
  // only messages that ACTUALLY happened count, i.e. inbound, or outbound that
  // genuinely sent. The engine auto-drafts a suggested reply after every
  // inbound, and counting that unsent draft would clear the flag on every
  // conversation at once.
  const latestInbound = new Map<string, { body: string; channel: string; created_at: string }>();
  for (const m of inboundRows ?? []) {
    // Rows arrive newest-first, so the first sighting of a prospect is their
    // most recent reply.
    if (!latestInbound.has(m.prospect_id)) {
      latestInbound.set(m.prospect_id, {
        body: String(m.body ?? ""),
        channel: String(m.channel ?? ""),
        created_at: m.created_at,
      });
    }
  }
  const repliedIds = [...latestInbound.keys()];
  // CHUNKED: every id rides in the request URL (~40 chars per UUID), and this
  // list is up to 400. A ~16KB URL is over the usual limit, the request fails,
  // and `data` comes back null — which here means lastSentTo is empty and
  // prospectById is empty, so this panel silently EMPTIES. The one surface
  // built to stop replies being missed would quietly stop showing them exactly
  // when there are enough replies to matter.
  const [sentRows, repliedProspects] = await Promise.all([
    selectAllRowsByIds<{ prospect_id: string; sent_at: string | null; created_at: string }>(
      repliedIds,
      (chunk) =>
        admin
          .from("ge_messages")
          .select("prospect_id, sent_at, created_at")
          .in("prospect_id", chunk)
          .eq("direction", "outbound")
          .eq("status", "sent")
    ),
    selectAllRowsByIds<{
      id: string;
      company: string;
      contact_name: string | null;
      status: string;
      lead_score: number | null;
    }>(repliedIds, (chunk) =>
      admin
        .from("ge_prospects")
        .select("id, company, contact_name, status, lead_score")
        .in("id", chunk)
    ),
  ]);

  const latestSent = new Map<string, string>();
  for (const m of sentRows ?? []) {
    // A send's real timestamp is sent_at; created_at is when the draft was
    // written (which can predate the reply it's being compared against).
    const at = m.sent_at ?? m.created_at;
    const current = latestSent.get(m.prospect_id);
    if (!current || at > current) latestSent.set(m.prospect_id, at);
  }
  const prospectById = new Map((repliedProspects ?? []).map((p) => [p.id, p]));
  const awaitingReply = repliedIds
    .filter((id) => {
      const inbound = latestInbound.get(id)!;
      // The RULE is shared with Jarvis's priorities panel now — the two
      // surfaces answered "how many replies are waiting on me?" differently
      // and Jarvis's answer was wrong. See lib/growth/awaiting.ts.
      return prospectById.has(id) && isAwaiting(inbound.created_at, latestSent.get(id));
    })
    .map((id) => ({ prospect: prospectById.get(id)!, inbound: latestInbound.get(id)! }))
    // Longest-waiting first — the one most at risk of going cold.
    .sort((a, b) => (a.inbound.created_at < b.inbound.created_at ? -1 : 1));

  // "Hot prospects" = the deals closest to a yes, so lead with pipeline STAGE,
  // not the research-time cold score: a lead in negotiation or with a proposal
  // out should sit above a fresh reply that happens to have a higher cold
  // score. Within a stage, the higher score comes first. Replied leads and the
  // committed later stages rank highest; the ones you're actively chasing
  // (contacted / follow-up sent) fill the rest by score. Capped at 20 and
  // auto-refilling as deals close.
  const HOT_STAGE_RANK: Record<string, number> = {
    negotiation: 8,
    proposal_sent: 7,
    proposal_in_progress: 6,
    meeting_booked: 5,
    qualified: 4,
    replied: 3,
    follow_up_sent: 2,
    contacted: 1,
  };
  const hotSorted = [...(hot ?? [])]
    .sort(
      (a, b) =>
        (HOT_STAGE_RANK[b.status] ?? 0) - (HOT_STAGE_RANK[a.status] ?? 0) ||
        (b.lead_score ?? 0) - (a.lead_score ?? 0)
    )
    .slice(0, 20);

  // Tally the overnight automation into a one-line "what the engine did".
  const nightlyLines = (nightly ?? []).map((a) => String(a.content));
  const autoStats = {
    researched: nightlyLines.filter((c) => /researched .* while you slept/i.test(c)).length,
    // Match BOTH chase drafts: touch 2 logs "drafted the follow-up (touch 2)"
    // and touch 3 logs "drafted the final follow-up (touch 3)" — the old
    // /drafted the follow-up/ missed every touch-3 draft, so the panel
    // under-reported the engine's overnight work.
    followUpsDrafted: nightlyLines.filter((c) => /drafted the (?:final )?follow-up/i.test(c)).length,
    firstQueued: nightlyLines.filter((c) => /auto-queued the first-touch/i.test(c)).length,
    followUpsQueued: nightlyLines.filter((c) => /auto-queued the follow-up/i.test(c)).length,
    harvested: nightlyLines.filter((c) => /found .* on their website/i.test(c)).length,
    // "healed a stuck lead" is a fix too — count it with the draft repairs.
    fixed: nightlyLines.filter((c) => /rewrote an outdated|repaired dead social|healed a stuck lead/i.test(c)).length,
  };
  const autoTotal = Object.values(autoStats).reduce((a, b) => a + b, 0);

  // "Ready to send" is the manual-send list; drop anything already queued for
  // the autopilot so a prospect isn't worked twice (queued + sent by hand).
  const queuedProspectIds = new Set(
    (queuedEmails ?? []).map((m) => m.prospect_id)
  );
  const readyList = (readyToSend ?? []).filter(
    (p) => !queuedProspectIds.has(p.id)
  );
  // True "ready" total = every ready-status prospect minus those already
  // queued for the autopilot (they're handled). The fetched rows only cover
  // the top 50, so subtract the queued∩ready overlap counted server-side.
  let readyTotal = readyList.length;
  if ((readyStatusCount ?? 0) > (readyToSend ?? []).length) {
    const queuedIds = [...queuedProspectIds];
    const { count: queuedReadyCount } = queuedIds.length
      ? await admin
          .from("ge_prospects")
          .select("id", { count: "exact", head: true })
          .in("status", ["research_complete", "outreach_ready"])
          .in("id", queuedIds)
      : { count: 0 };
    readyTotal = Math.max(
      readyList.length,
      (readyStatusCount ?? 0) - (queuedReadyCount ?? 0)
    );
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Good {(() => { const h = dublinHour(); return h < 12 ? "morning" : h < 18 ? "afternoon" : "evening"; })()}, {member.name.split(" ")[0]}</h1>
          <p>Today&apos;s priorities first — then research the next company.</p>
        </div>
      </div>

      {/* WHERE THE LEADS ACTUALLY ARE.
          "757 leads and two replies" reads as a pitch problem, and usually
          isn't one — it's a throughput problem. Two replies from 60 emails is
          a normal cold-outreach rate; two from 700 is a real problem. Those
          are opposite diagnoses with opposite fixes, and nothing on this page
          could tell them apart. Each bar is a stage, so the drop-off shows
          exactly where the pipeline is stuck. */}
      {(totalLeads ?? 0) > 0 && (() => {
        const total = totalLeads ?? 0;
        const contacted = everContacted ?? 0;
        const replies = repliedIds.length;
        const stages = [
          { label: "In the engine", n: total, href: "/growth/prospects" },
          { label: "Researched", n: researchedLeads ?? 0, href: "/growth/prospects?status=research_complete" },
          { label: "Have an email address", n: leadsWithEmail ?? 0, href: "/growth/prospects" },
          { label: "Email written, not sent", n: emailDrafts ?? 0, href: "/growth/prospects?status=outreach_ready" },
          { label: "Actually contacted", n: contacted, href: "/growth/prospects?due=live" },
          { label: "Replied", n: replies, href: "/growth/inbox" },
        ];
        // The reply rate that means anything is against people ACTUALLY
        // emailed, never against the whole list.
        const rate = contacted > 0 ? (replies / contacted) * 100 : 0;
        const neverContacted = Math.max(0, total - contacted);
        return (
          <section className="panel panel-block" style={{ marginBottom: 14 }} aria-labelledby="funnel-title">
            <h2 className="panel-title" id="funnel-title">
              <TrendingUp size={15} style={{ verticalAlign: "-2px" }} /> Where your leads
              actually are
            </h2>
            <div style={{ display: "grid", gap: 6, marginTop: 4 }}>
              {stages.map((s) => (
                <Link key={s.label} href={s.href} className="ge-funnel-row">
                  <strong>{s.n.toLocaleString("en-IE")}</strong>
                  <span className="ge-funnel-label">{s.label}</span>
                  <span className="ge-funnel-track" aria-hidden>
                    <span
                      className="ge-funnel-bar"
                      style={{
                        width: `${total > 0 ? Math.max(1.5, (s.n / total) * 100) : 0}%`,
                      }}
                    />
                  </span>
                </Link>
              ))}
            </div>
            <p style={{ fontSize: 13, margin: "12px 0 0", lineHeight: 1.6 }}>
              {contacted === 0 ? (
                <>
                  <strong>Nothing has gone out yet.</strong> Every lead here is still
                  waiting on a first touch — the reply rate can&apos;t tell you anything
                  until it does.
                </>
              ) : (
                <>
                  <strong>
                    {replies} {replies === 1 ? "reply" : "replies"} from {contacted}{" "}
                    contacted = {rate.toFixed(1)}%
                  </strong>{" "}
                  {rate >= 2
                    ? "— that's a normal cold-outreach rate, so the pitch is working about as well as anyone's. "
                    : "— that's below the 2–5% a cold list usually returns, so the copy or the deliverability is worth a look. "}
                  {neverContacted > 0 && (
                    <>
                      The bigger number is{" "}
                      <strong>{neverContacted.toLocaleString("en-IE")} never contacted at
                      all</strong>{" "}
                      — that&apos;s where the calls are, not in the reply rate.
                    </>
                  )}
                </>
              )}
            </p>
          </section>
        );
      })()}

      {/* Above everything else on purpose: someone who wrote back and hasn't
          been answered outranks every chase, every cold lead and every stat on
          this page. Rendered only when there's something to act on, so a clear
          inbox costs no space. */}
      {awaitingReply.length > 0 && (
        <section
          className="panel panel-block"
          style={{ marginBottom: 20, borderLeft: "3px solid var(--orange, #fb923c)" }}
          aria-labelledby="awaiting-title"
        >
          <h2 className="panel-title" id="awaiting-title" style={{ marginBottom: 6 }}>
            <MessageSquare size={15} style={{ verticalAlign: "-2px", color: "var(--orange, #fb923c)" }} />{" "}
            {awaitingReply.length} {awaitingReply.length === 1 ? "reply is" : "replies are"} waiting on you
            <Link href="/growth/inbox">Open inbox →</Link>
          </h2>
          <p style={{ fontSize: 12.5, color: "var(--faint)", margin: "0 0 10px" }}>
            They answered and haven&apos;t heard back. Answer these before
            anything else on this page.
          </p>
          <div style={{ display: "grid", gap: 8 }}>
            {awaitingReply.slice(0, 8).map(({ prospect, inbound }) => {
              const waitedDays = Math.floor(
                (Date.now() - new Date(inbound.created_at).getTime()) / 86400000
              );
              return (
                <Link
                  key={prospect.id}
                  href={`/growth/inbox?p=${prospect.id}`}
                  className="panel"
                  style={{ padding: "9px 11px", display: "block" }}
                >
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <strong style={{ fontSize: 14 }}>{prospect.company}</strong>
                    {prospect.contact_name && (
                      <span style={{ fontSize: 12, color: "var(--faint)" }}>{prospect.contact_name}</span>
                    )}
                    <span style={{ fontSize: 11, color: "var(--faint)" }}>
                      {CHANNEL_META[inbound.channel as Channel]?.label ?? inbound.channel}
                    </span>
                    {/* Waiting time is the whole point — an hour old is fine,
                        four days old is a deal quietly dying. */}
                    <span
                      className={`badge ${waitedDays >= 2 ? "badge-orange" : "badge-gray"}`}
                      style={{ marginLeft: "auto" }}
                    >
                      {waitedDays < 1 ? "today" : waitedDays === 1 ? "1 day" : `${waitedDays} days`}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: 12.5,
                      color: "var(--faint)",
                      marginTop: 3,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {inbound.body}
                  </div>
                </Link>
              );
            })}
          </div>
          {awaitingReply.length > 8 && (
            <p style={{ fontSize: 12.5, margin: "10px 0 0" }}>
              <Link href="/growth/inbox">See all {awaitingReply.length} in the inbox →</Link>
            </p>
          )}
        </section>
      )}

      {/* The engine's own work in the last 24h — proof the automation ran. */}
      {autoTotal > 0 && (
        <section
          className="panel panel-block"
          style={{ marginBottom: 20, borderLeft: "3px solid var(--ac1, #8b5cf6)" }}
          aria-label="What the engine did"
        >
          <h2 className="panel-title" style={{ marginBottom: 6 }}>
            <Sparkles size={15} style={{ verticalAlign: "-2px" }} /> The engine
            worked overnight
          </h2>
          <p style={{ fontSize: 13.5, color: "var(--body)", margin: 0 }}>
            {[
              autoStats.researched && `researched ${autoStats.researched} new lead${autoStats.researched === 1 ? "" : "s"}`,
              autoStats.followUpsDrafted && `drafted ${autoStats.followUpsDrafted} follow-up${autoStats.followUpsDrafted === 1 ? "" : "s"}`,
              autoStats.firstQueued && `queued ${autoStats.firstQueued} first-touch email${autoStats.firstQueued === 1 ? "" : "s"}`,
              autoStats.followUpsQueued && `queued ${autoStats.followUpsQueued} chase${autoStats.followUpsQueued === 1 ? "" : "s"}`,
              autoStats.harvested && `found contact details for ${autoStats.harvested}`,
              autoStats.fixed && `tidied ${autoStats.fixed} draft${autoStats.fixed === 1 ? "" : "s"}`,
            ]
              .filter(Boolean)
              .join(" · ")}
            . All hands-off — you just work the replies and the calls.
          </p>
        </section>
      )}

      {/* The daily entry point: paste a website, get a researched prospect.
          Collapsed once the pipeline exists so the day's PRIORITIES lead the
          page — the form is one tap away, not a wall above the plan. */}
      <details
        className="panel panel-block"
        style={{ marginBottom: 20 }}
        open={metrics.prospectsTotal === 0}
      >
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>
          <Sparkles size={15} style={{ verticalAlign: "-2px" }} /> Research a
          company (paste a website)
        </summary>
        <p style={{ fontSize: 13, color: "var(--faint)", marginTop: 10 }}>
          Paste a website. The AI writes the company report, spots the pain
          points, recommends solutions, scores the lead and drafts outreach
          for every channel — then opens the prospect workspace. No website?
          Just give the company name — the engine treats a missing website as
          the pitch (Website with Lead Capture).
        </p>
        <ActionForm action={quickResearch}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div style={{ flex: "2 1 260px" }}>
              <label htmlFor="qr-website">Company website (or leave blank)</label>
              <input id="qr-website" name="website" placeholder="https://…" maxLength={300} style={{ width: "100%" }} />
            </div>
            <div style={{ flex: "1 1 180px" }}>
              <label htmlFor="qr-company">Company name (required if no website)</label>
              <input id="qr-company" name="company" maxLength={200} style={{ width: "100%" }} />
            </div>
            <div style={{ flex: "1 1 180px" }}>
              <label htmlFor="qr-contact">Contact name (optional)</label>
              <input id="qr-contact" name="contact_name" maxLength={200} style={{ width: "100%" }} />
            </div>
          </div>
          <details style={{ marginTop: 8 }}>
            <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--faint)" }}>
              More details (LinkedIn, Instagram, email, phone)
            </summary>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
              <div style={{ flex: "1 1 200px" }}>
                <label htmlFor="qr-linkedin">LinkedIn URL</label>
                <input id="qr-linkedin" name="linkedin_url" maxLength={500} style={{ width: "100%" }} />
              </div>
              <div style={{ flex: "1 1 200px" }}>
                <label htmlFor="qr-instagram">Instagram URL</label>
                <input id="qr-instagram" name="instagram_url" maxLength={500} style={{ width: "100%" }} />
              </div>
              <div style={{ flex: "1 1 200px" }}>
                <label htmlFor="qr-facebook">Facebook URL</label>
                <input id="qr-facebook" name="facebook_url" maxLength={500} style={{ width: "100%" }} />
              </div>
              <div style={{ flex: "1 1 180px" }}>
                <label htmlFor="qr-email">Email</label>
                <input id="qr-email" name="email" type="email" maxLength={300} style={{ width: "100%" }} />
              </div>
              <div style={{ flex: "1 1 140px" }}>
                <label htmlFor="qr-phone">Phone</label>
                <input id="qr-phone" name="phone" maxLength={50} style={{ width: "100%" }} />
              </div>
            </div>
          </details>
          <div className="form-actions">
            <SubmitButton pendingText="Researching — reading the website and writing the report (30–60s)…">
              <Sparkles size={14} /> Research company
            </SubmitButton>
          </div>
        </ActionForm>
      </details>

      {readyList.length > 0 && (
        <section
          className="panel panel-block"
          style={{ marginBottom: 20, borderLeft: "3px solid var(--green, #34d399)" }}
          aria-labelledby="rts-title"
        >
          <h2 className="panel-title" id="rts-title">
            <Send size={15} style={{ verticalAlign: "-2px" }} /> Ready to send —
            researched, drafts waiting ({readyTotal})
          </h2>
          <p style={{ fontSize: 12, color: "var(--faint)", marginTop: 0 }}>
            Highest score first. Open → skim the report → copy the draft →
            send → Mark as sent. ~3 minutes each.
          </p>
          <div className="table-wrap">
            <table>
              <tbody>
                {readyList.slice(0, 12).map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/growth/prospects/${p.id}?tab=studio`}>
                        <strong>{p.company}</strong>
                      </Link>
                      <div style={{ color: "var(--faint)", fontSize: 12 }}>{p.contact_name}</div>
                    </td>
                    <td style={{ fontSize: 13 }}>{p.industry ?? "—"}</td>
                    {/* Same null-score guard as ProspectList — an unscored lead
                        rendered a bare "/100" here. */}
                    <td style={{ fontSize: 13, whiteSpace: "nowrap" }}>
                      {p.lead_score != null && p.lead_score > 0 ? `${p.lead_score}/100` : "—"}
                    </td>
                    <td>
                      <Link
                        href={`/growth/prospects/${p.id}?tab=studio`}
                        className="btn btn-primary btn-sm"
                      >
                        Open studio →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {readyTotal > 12 && (
            <p style={{ fontSize: 12, marginTop: 8 }}>
              <Link href="/growth/prospects?status=research_complete&sort=score">
                See all {readyTotal} →
              </Link>
            </p>
          )}
        </section>
      )}

      {((dueTodayCount ?? 0) + (overdueCount ?? 0)) > 0 && (
        <section
          className="panel panel-block"
          style={{
            marginTop: 20,
            marginBottom: 4,
            borderLeft: "3px solid var(--ac2, #3b82f6)",
            display: "flex",
            gap: 12,
            alignItems: "center",
            flexWrap: "wrap",
            justifyContent: "space-between",
          }}
          aria-label="Send due follow-ups"
        >
          <div style={{ fontSize: 13, flex: "1 1 260px" }}>
            <strong>Fire the due email follow-ups.</strong>{" "}
            <span style={{ color: "var(--faint)" }}>
              Sends every due chase that has an email and a ready draft — same
              review as the morning run, capped, gone-cold leads left parked. The
              ones without an email are yours to call.
            </span>
          </div>
          <ActionForm action={sendDueFollowups}>
            <SubmitButton className="btn btn-primary btn-sm" pendingText="Sending…">
              <Send size={13} /> Send due email follow-ups
            </SubmitButton>
          </ActionForm>
        </section>
      )}

      <div className="grid-2">
        <section className="panel panel-block" aria-labelledby="fu-today">
          <h2 className="panel-title" id="fu-today">
            <AlarmClock size={15} style={{ verticalAlign: "-2px" }} /> Today&apos;s follow-ups ({dueTodayCount ?? (dueToday ?? []).length})
          </h2>
          {(dueToday ?? []).length === 0 ? (
            <p className="empty-state">Nothing due today.</p>
          ) : (
            <>
              <ProspectList rows={dueToday ?? []} dateField="follow_up" />
              {(dueTodayCount ?? 0) > (dueToday ?? []).length && (
                <p style={{ fontSize: 12, marginTop: 8 }}>
                  <Link href="/growth/prospects?due=today&sort=follow_up">
                    See all {dueTodayCount} →
                  </Link>
                </p>
              )}
            </>
          )}
        </section>

        <section className="panel panel-block" aria-labelledby="fu-overdue">
          <h2 className="panel-title" id="fu-overdue">
            <AlarmClock size={15} style={{ verticalAlign: "-2px", color: "var(--red, #f87171)" }} /> Overdue ({overdueCount ?? (overdue ?? []).length})
          </h2>
          {(overdue ?? []).length === 0 ? (
            // "Clean pipeline" is only true if there's actually something in
            // it. An empty overdue list looks identical whether every chase
            // was worked or whether nobody has a next step at all — and the
            // second one is a leak being reported as praise.
            (unscheduledCount ?? 0) > 0 ? (
              <p className="empty-state" style={{ color: "var(--orange, #fb923c)" }}>
                Nothing overdue — but{" "}
                <strong>
                  {unscheduledCount} prospect{unscheduledCount === 1 ? "" : "s"} you&apos;ve
                  already contacted {unscheduledCount === 1 ? "has" : "have"} no next step
                  booked
                </strong>
                , so nothing will ever bring {unscheduledCount === 1 ? "it" : "them"} back
                up.{" "}
                <Link href="/growth/prospects?due=unscheduled">Give them a date →</Link>
              </p>
            ) : (
              <p className="empty-state">Nothing overdue — clean pipeline.</p>
            )
          ) : (
            <>
              <ProspectList rows={overdue ?? []} dateField="follow_up" />
              {(overdueCount ?? 0) > (overdue ?? []).length && (
                <p style={{ fontSize: 12, marginTop: 8 }}>
                  <Link href="/growth/prospects?due=overdue&sort=follow_up">
                    See all {overdueCount} →
                  </Link>
                </p>
              )}
            </>
          )}
        </section>
      </div>

      {(goneColdCount ?? 0) > 0 && (
        <section
          className="panel panel-block"
          style={{ marginTop: 20, borderLeft: "3px solid var(--faint, #6f6f7a)" }}
          aria-labelledby="gc-title"
        >
          <h2 className="panel-title" id="gc-title">
            🧊 Gone cold — follow-up overdue 7+ days ({goneColdCount})
          </h2>
          <p style={{ fontSize: 12, color: "var(--faint)", marginTop: 0 }}>
            Parked here so your due lists (and the morning autopilot) stay timely —
            these aren&apos;t chased automatically any more. Revive one with a
            fresh follow-up date on its Details tab, or a new angle from the
            Studio; or tick the dead ones in the list and bulk archive.
          </p>
          <ProspectList rows={goneCold ?? []} dateField="follow_up" />
          {(goneColdCount ?? 0) > (goneCold ?? []).length && (
            <p style={{ fontSize: 12, marginTop: 8 }}>
              <Link href="/growth/prospects?due=cold&sort=follow_up">
                See all {goneColdCount} →
              </Link>
            </p>
          )}
        </section>
      )}

      <div className="grid-2" style={{ marginTop: 20 }}>
        <section className="panel panel-block" aria-labelledby="hot-title">
          <h2 className="panel-title" id="hot-title">
            <Flame size={15} style={{ verticalAlign: "-2px", color: "var(--orange, #fb923c)" }} /> Hot prospects
          </h2>
          {hotSorted.length === 0 ? (
            <p className="empty-state">No live conversations yet — research and reach out above.</p>
          ) : (
            <ProspectList rows={hotSorted} />
          )}
        </section>

        <section className="panel panel-block" aria-labelledby="mt-title">
          <h2 className="panel-title" id="mt-title">
            <CalendarCheck size={15} style={{ verticalAlign: "-2px" }} /> Upcoming meetings{" "}
            <Link href="/growth/meetings">All →</Link>
          </h2>
          {nextMeetings.length === 0 ? (
            /* A booked session is the ENTIRE point of the engine, and this
               was a full stop on the page Jude opens first. The meetings page
               two clicks away already says what fills it; this one said
               nothing. Same route, stated here. */
            <p className="empty-state" style={{ margin: 0 }}>
              Nothing booked yet. Sessions land here when a prospect books
              through your link, or when you record one.{" "}
              <Link href="/growth/call-list">Work the call list</Link> and send
              anyone warm the booking link.
            </p>
          ) : (
            <div className="table-wrap">
              <table>
                <tbody>
                  {nextMeetings.map((m) => (
                    <tr key={m.id}>
                      <td>
                        <Link href={`/growth/prospects/${m.prospect_id}`}>
                          <strong>
                            {(m.ge_prospects as unknown as { company: string } | null)?.company ?? "—"}
                          </strong>
                        </Link>
                      </td>
                      <td style={{ fontSize: 13 }}>
                        {new Date(m.scheduled_at).toLocaleString("en-IE", {
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                          // Booking-page slots are labelled by UTC wall-clock;
                          // render synced bookings the same way the customer saw
                          // them, not shifted +1h by Dublin conversion.
                          timeZone: m.strategy_booking_id ? "UTC" : "Europe/Dublin",
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <div className="grid-2" style={{ marginTop: 20 }}>
        <section className="panel panel-block" aria-labelledby="rc-title">
          <h2 className="panel-title" id="rc-title">
            Recently contacted
          </h2>
          {(recentContacted ?? []).length === 0 ? (
            <p className="empty-state">No outreach sent yet.</p>
          ) : (
            <ProspectList rows={recentContacted ?? []} dateField="last_contact" />
          )}
        </section>

        <section className="panel panel-block" aria-labelledby="kpi-title">
          <h2 className="panel-title" id="kpi-title">
            Last 30 days <Link href="/growth/analytics">Analytics →</Link>
          </h2>
          <div className="stat-grid" style={{ marginTop: 4 }}>
            <StatCard label="Leads added" value={metrics.leadsAdded} icon={<Users />} />
            <StatCard label="Outreach sent" value={metrics.outreachSent} icon={<Send />} accent="var(--ac1, #8b5cf6)" />
            <StatCard label="Reply rate" value={`${metrics.replyRate}%`} icon={<MessageSquare />} accent="var(--green, #34d399)" />
            <StatCard label="Meetings" value={metrics.meetingsBooked} icon={<CalendarCheck />} accent="var(--ac2)" />
            <StatCard label="Conversion" value={`${metrics.conversionRate}%`} icon={<TrendingUp />} />
            <StatCard label="Proposals sent" value={metrics.proposalsSent} icon={<FileText />} accent="var(--orange, #fb923c)" />
            {/* ALL TIME, under a heading that says "Last 30 days".
                pipelineValue is a snapshot of every open and won deal — it is
                not a 30-day flow, and unlike the six windowed tiles beside it
                it does not change when the window does. Sitting unmarked in
                this block it read as "we built €X of pipeline this month",
                on the one number that is about money.

                The Analytics page already carries exactly this hint on
                exactly this card (and its own comment explains why); the
                dashboard, which is read far more often, carried none. */}
            <StatCard
              label="Pipeline value"
              value={`€${Math.round(metrics.pipelineValue).toLocaleString("en-IE")}`}
              icon={<Euro />}
              accent="var(--green, #34d399)"
              hint="all time · open + won"
            />
          </div>
        </section>
      </div>
    </>
  );
}
