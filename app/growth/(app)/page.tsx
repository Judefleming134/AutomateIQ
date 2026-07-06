import Link from "next/link";
import {
  Users,
  Send,
  MessageSquare,
  CalendarCheck,
  TrendingUp,
  Euro,
  ThumbsUp,
  Target,
} from "lucide-react";
import { requireGrowth } from "@/lib/growth/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadGrowthMetrics } from "@/lib/growth/metrics";
import { StatCard } from "@/components/portal/stat-card";
import { PROSPECT_STATUS_META, type ProspectStatus } from "@/lib/growth/constants";

export default async function GrowthDashboardPage() {
  const { member } = await requireGrowth();
  const admin = createAdminClient();

  const today = new Date().toISOString().slice(0, 10);
  const [metrics, { data: dueFollowUps }, { data: openTasks }, { data: recentProspects }] =
    await Promise.all([
      loadGrowthMetrics(admin, 30),
      admin
        .from("ge_prospects")
        .select("id, company, contact_name, status, next_follow_up_at")
        .lte("next_follow_up_at", today)
        .not("status", "in", '("won","lost","do_not_contact")')
        .order("next_follow_up_at", { ascending: true })
        .limit(8),
      admin
        .from("ge_tasks")
        .select("id, title, due_at, prospect_id, ge_prospects(company)")
        .eq("status", "open")
        .order("due_at", { ascending: true, nullsFirst: false })
        .limit(8),
      admin
        .from("ge_prospects")
        .select("id, company, contact_name, status, created_at")
        .order("created_at", { ascending: false })
        .limit(6),
    ]);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Growth Engine</h1>
          <p>
            Welcome back, {member.name.split(" ")[0]} — the last 30 days across
            all channels.
          </p>
        </div>
        <Link href="/growth/prospects" className="btn btn-primary">
          Add prospects
        </Link>
      </div>

      <div className="stat-grid">
        <StatCard
          label="Leads added (30d)"
          value={metrics.leadsAdded}
          icon={<Users />}
          hint={`${metrics.prospectsTotal} total`}
        />
        <StatCard
          label="Outreach sent (30d)"
          value={metrics.outreachSent}
          icon={<Send />}
          accent="var(--ac1, #8b5cf6)"
          hint={`${metrics.queuedOutreach} queued`}
        />
        <StatCard
          label="Reply rate"
          value={`${metrics.replyRate}%`}
          icon={<MessageSquare />}
          accent="var(--green, #34d399)"
          hint={`${metrics.replies} replies`}
        />
        <StatCard
          label="Positive responses"
          value={`${metrics.positiveRate}%`}
          icon={<ThumbsUp />}
          accent="var(--green, #34d399)"
          hint={`${metrics.positiveReplies} positive`}
        />
        <StatCard
          label="Meetings booked (30d)"
          value={metrics.meetingsBooked}
          icon={<CalendarCheck />}
          accent="var(--ac2)"
        />
        <StatCard
          label="Conversion rate"
          value={`${metrics.conversionRate}%`}
          icon={<TrendingUp />}
          hint="contacted → meeting"
        />
        <StatCard
          label="Qualified leads"
          value={metrics.qualified}
          icon={<Target />}
          accent="var(--orange, #fb923c)"
        />
        <StatCard
          label="Pipeline value"
          value={`€${Math.round(metrics.pipelineValue).toLocaleString("en-IE")}`}
          icon={<Euro />}
          accent="var(--green, #34d399)"
        />
      </div>

      <div className="grid-2" style={{ marginTop: 24 }}>
        <section className="panel panel-block" aria-labelledby="due-followups">
          <h2 className="panel-title" id="due-followups">
            Follow-ups due <Link href="/growth/prospects">All prospects →</Link>
          </h2>
          {(dueFollowUps ?? []).length === 0 ? (
            <p className="empty-state">Nothing due — the pipeline is clear.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Prospect</th>
                    <th>Status</th>
                    <th>Due</th>
                  </tr>
                </thead>
                <tbody>
                  {(dueFollowUps ?? []).map((p) => {
                    const meta = PROSPECT_STATUS_META[p.status as ProspectStatus];
                    return (
                      <tr key={p.id}>
                        <td>
                          <Link href={`/growth/prospects/${p.id}`}>
                            <strong>{p.company}</strong>
                          </Link>
                          <div style={{ color: "var(--faint)", fontSize: 12 }}>
                            {p.contact_name}
                          </div>
                        </td>
                        <td>
                          <span className={`badge ${meta?.badge ?? "badge-gray"}`}>
                            {meta?.label ?? p.status}
                          </span>
                        </td>
                        <td>{p.next_follow_up_at}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel panel-block" aria-labelledby="open-tasks">
          <h2 className="panel-title" id="open-tasks">
            Open tasks
          </h2>
          {(openTasks ?? []).length === 0 ? (
            <p className="empty-state">No open tasks.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Task</th>
                    <th>Prospect</th>
                    <th>Due</th>
                  </tr>
                </thead>
                <tbody>
                  {(openTasks ?? []).map((t) => {
                    const company = (
                      t.ge_prospects as unknown as { company: string } | null
                    )?.company;
                    return (
                      <tr key={t.id}>
                        <td>{t.title}</td>
                        <td>
                          {t.prospect_id && company ? (
                            <Link href={`/growth/prospects/${t.prospect_id}`}>
                              {company}
                            </Link>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>{t.due_at ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <div className="grid-2" style={{ marginTop: 20 }}>
        <section className="panel panel-block" aria-labelledby="top-campaigns">
          <h2 className="panel-title" id="top-campaigns">
            Top campaigns <Link href="/growth/campaigns">All campaigns →</Link>
          </h2>
          {metrics.topCampaigns.length === 0 ? (
            <p className="empty-state">
              No campaigns yet — create one to organise your outreach.
            </p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Campaign</th>
                    <th>Sent</th>
                    <th>Replies</th>
                    <th>Meetings</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.topCampaigns.slice(0, 5).map((c) => (
                    <tr key={c.id}>
                      <td>
                        <Link href={`/growth/campaigns/${c.id}`}>{c.name}</Link>
                      </td>
                      <td>{c.sent}</td>
                      <td>{c.replies}</td>
                      <td>{c.meetings}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel panel-block" aria-labelledby="recent-prospects">
          <h2 className="panel-title" id="recent-prospects">
            Recently added
          </h2>
          {(recentProspects ?? []).length === 0 ? (
            <p className="empty-state">
              No prospects yet — add your first from the Prospects screen.
            </p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Prospect</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(recentProspects ?? []).map((p) => {
                    const meta = PROSPECT_STATUS_META[p.status as ProspectStatus];
                    return (
                      <tr key={p.id}>
                        <td>
                          <Link href={`/growth/prospects/${p.id}`}>
                            <strong>{p.company}</strong>
                          </Link>
                          <div style={{ color: "var(--faint)", fontSize: 12 }}>
                            {p.contact_name}
                          </div>
                        </td>
                        <td>
                          <span className={`badge ${meta?.badge ?? "badge-gray"}`}>
                            {meta?.label ?? p.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
