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
import { loadGrowthMetrics } from "@/lib/growth/metrics";
import { StatCard } from "@/components/portal/stat-card";
import { ActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/admin/submit-button";
import {
  CLOSED_STATUSES,
  PROSPECT_STATUS_META,
  type ProspectStatus,
} from "@/lib/growth/constants";
import { dublinDate, dublinHour } from "@/lib/growth/dates";
import { quickResearch } from "./prospects/actions";

// Quick research runs a full AI research pass inside this route's actions.
export const maxDuration = 60;

type ProspectRow = {
  id: string;
  company: string;
  contact_name: string;
  status: string;
  lead_score: number;
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
                      : `${p.lead_score}/100`}
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

  const [
    metrics,
    { data: readyToSend },
    { data: dueToday },
    { data: overdue },
    { data: hot },
    { data: recentContacted },
    { data: upcomingMeetings },
    { data: queuedEmails },
    { data: nightly },
    { count: dueTodayCount },
    { count: overdueCount },
  ] = await Promise.all([
    loadGrowthMetrics(admin, 30),
    admin
      .from("ge_prospects")
      .select("id, company, contact_name, industry, lead_score, status")
      .in("status", ["research_complete", "outreach_ready"])
      .order("lead_score", { ascending: false })
      .limit(50),
    admin
      .from("ge_prospects")
      .select("id, company, contact_name, status, lead_score, next_follow_up_at, last_contact_at")
      .eq("next_follow_up_at", today)
      .not("status", "in", activeFilter)
      .order("lead_score", { ascending: false })
      .limit(10),
    admin
      .from("ge_prospects")
      .select("id, company, contact_name, status, lead_score, next_follow_up_at, last_contact_at")
      .lt("next_follow_up_at", today)
      .not("status", "in", activeFilter)
      .order("next_follow_up_at", { ascending: true })
      .limit(10),
    admin
      .from("ge_prospects")
      .select("id, company, contact_name, status, lead_score, next_follow_up_at, last_contact_at")
      .in("status", ["replied", "qualified", "meeting_booked", "proposal_in_progress", "proposal_sent", "negotiation"])
      .order("lead_score", { ascending: false })
      .limit(8),
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
      .gte("scheduled_at", new Date().toISOString())
      .order("scheduled_at", { ascending: true })
      .limit(6),
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
      .not("status", "in", activeFilter),
  ]);

  // Tally the overnight automation into a one-line "what the engine did".
  const nightlyLines = (nightly ?? []).map((a) => String(a.content));
  const autoStats = {
    researched: nightlyLines.filter((c) => /researched .* while you slept/i.test(c)).length,
    followUpsDrafted: nightlyLines.filter((c) => /drafted the follow-up/i.test(c)).length,
    firstQueued: nightlyLines.filter((c) => /auto-queued the first-touch/i.test(c)).length,
    followUpsQueued: nightlyLines.filter((c) => /auto-queued the follow-up/i.test(c)).length,
    harvested: nightlyLines.filter((c) => /found .* on their website/i.test(c)).length,
    fixed: nightlyLines.filter((c) => /rewrote an outdated|repaired dead social/i.test(c)).length,
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

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Good {(() => { const h = dublinHour(); return h < 12 ? "morning" : h < 18 ? "afternoon" : "evening"; })()}, {member.name.split(" ")[0]}</h1>
          <p>Today&apos;s priorities first — then research the next company.</p>
        </div>
      </div>

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
            researched, drafts waiting ({readyList.length})
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
                    <td style={{ fontSize: 13, whiteSpace: "nowrap" }}>{p.lead_score}/100</td>
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
          {readyList.length > 12 && (
            <p style={{ fontSize: 12, marginTop: 8 }}>
              <Link href="/growth/prospects?status=research_complete&sort=score">
                See all {readyList.length} →
              </Link>
            </p>
          )}
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
                  <Link href="/growth/prospects?sort=follow_up">
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
            <p className="empty-state">Nothing overdue — clean pipeline.</p>
          ) : (
            <>
              <ProspectList rows={overdue ?? []} dateField="follow_up" />
              {(overdueCount ?? 0) > (overdue ?? []).length && (
                <p style={{ fontSize: 12, marginTop: 8 }}>
                  <Link href="/growth/prospects?sort=follow_up">
                    See all {overdueCount} →
                  </Link>
                </p>
              )}
            </>
          )}
        </section>
      </div>

      <div className="grid-2" style={{ marginTop: 20 }}>
        <section className="panel panel-block" aria-labelledby="hot-title">
          <h2 className="panel-title" id="hot-title">
            <Flame size={15} style={{ verticalAlign: "-2px", color: "var(--orange, #fb923c)" }} /> Hot prospects
          </h2>
          {(hot ?? []).length === 0 ? (
            <p className="empty-state">No live conversations yet — research and reach out above.</p>
          ) : (
            <ProspectList rows={hot ?? []} />
          )}
        </section>

        <section className="panel panel-block" aria-labelledby="mt-title">
          <h2 className="panel-title" id="mt-title">
            <CalendarCheck size={15} style={{ verticalAlign: "-2px" }} /> Upcoming meetings{" "}
            <Link href="/growth/meetings">All →</Link>
          </h2>
          {(upcomingMeetings ?? []).length === 0 ? (
            <p className="empty-state">No meetings booked yet.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <tbody>
                  {(upcomingMeetings ?? []).map((m) => (
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
            <StatCard
              label="Pipeline value"
              value={`€${Math.round(metrics.pipelineValue).toLocaleString("en-IE")}`}
              icon={<Euro />}
              accent="var(--green, #34d399)"
            />
          </div>
        </section>
      </div>
    </>
  );
}
