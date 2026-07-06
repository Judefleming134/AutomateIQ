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

  const today = new Date().toISOString().slice(0, 10);
  const activeFilter = `(${CLOSED_STATUSES.map((s) => `"${s}"`).join(",")})`;

  const [
    metrics,
    { data: dueToday },
    { data: overdue },
    { data: hot },
    { data: recentContacted },
    { data: upcomingMeetings },
  ] = await Promise.all([
    loadGrowthMetrics(admin, 30),
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
      .select("id, scheduled_at, status, prospect_id, ge_prospects(company)")
      .eq("status", "booked")
      .gte("scheduled_at", new Date().toISOString())
      .order("scheduled_at", { ascending: true })
      .limit(6),
  ]);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Good {new Date().getHours() < 12 ? "morning" : "afternoon"}, {member.name.split(" ")[0]}</h1>
          <p>Today&apos;s priorities first — then research the next company.</p>
        </div>
      </div>

      {/* The daily entry point: paste a website, get a researched prospect. */}
      <section className="panel panel-block" style={{ marginBottom: 20 }} aria-labelledby="qr-title">
        <h2 className="panel-title" id="qr-title">
          <Sparkles size={15} style={{ verticalAlign: "-2px" }} /> Research a company
        </h2>
        <p style={{ fontSize: 13, color: "var(--faint)", marginTop: 0 }}>
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
      </section>

      <div className="grid-2">
        <section className="panel panel-block" aria-labelledby="fu-today">
          <h2 className="panel-title" id="fu-today">
            <AlarmClock size={15} style={{ verticalAlign: "-2px" }} /> Today&apos;s follow-ups ({(dueToday ?? []).length})
          </h2>
          {(dueToday ?? []).length === 0 ? (
            <p className="empty-state">Nothing due today.</p>
          ) : (
            <ProspectList rows={dueToday ?? []} dateField="follow_up" />
          )}
        </section>

        <section className="panel panel-block" aria-labelledby="fu-overdue">
          <h2 className="panel-title" id="fu-overdue">
            <AlarmClock size={15} style={{ verticalAlign: "-2px", color: "var(--red, #f87171)" }} /> Overdue ({(overdue ?? []).length})
          </h2>
          {(overdue ?? []).length === 0 ? (
            <p className="empty-state">Nothing overdue — clean pipeline.</p>
          ) : (
            <ProspectList rows={overdue ?? []} dateField="follow_up" />
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
                          timeZone: "Europe/Dublin",
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
