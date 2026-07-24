import Link from "next/link";
import {
  Users,
  Send,
  MessageSquare,
  CalendarCheck,
  TrendingUp,
  Euro,
  ThumbsUp,
  Trophy,
  Sparkles,
  FileText,
  PenLine,
  Download,
} from "lucide-react";
import { requireGrowth } from "@/lib/growth/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadGrowthMetrics } from "@/lib/growth/metrics";
import { StatCard } from "@/components/portal/stat-card";
import { CHANNEL_META, type Channel } from "@/lib/growth/constants";

const WINDOWS = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: null, label: "All time" },
] as const;

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  await requireGrowth();
  const params = await searchParams;
  const days =
    params.days === "all" ? null : [7, 30, 90].includes(Number(params.days)) ? Number(params.days) : 30;

  const admin = createAdminClient();
  const metrics = await loadGrowthMetrics(admin, days);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Analytics</h1>
          <p>Outreach performance across every channel and campaign.</p>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {WINDOWS.map((w) => (
            <Link
              key={w.label}
              href={`/growth/analytics?days=${w.days ?? "all"}`}
              className={`btn btn-sm ${days === w.days ? "btn-primary" : "btn-secondary"}`}
            >
              {w.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="stat-grid">
        <StatCard label="Leads added" value={metrics.leadsAdded} icon={<Users />} hint={`${metrics.prospectsTotal} total`} />
        <StatCard label="Companies researched" value={metrics.companiesResearched} icon={<Sparkles />} accent="var(--ac1, #8b5cf6)" />
        <StatCard label="Outreach prepared" value={metrics.draftOutreach + metrics.queuedOutreach} icon={<PenLine />} hint={`${metrics.draftOutreach} drafts · ${metrics.queuedOutreach} queued`} />
        <StatCard label="Messages sent" value={metrics.outreachSent} icon={<Send />} accent="var(--ac1, #8b5cf6)" hint={`${metrics.contacted} prospects reached`} />
        <StatCard label="Reply rate" value={`${metrics.replyRate}%`} icon={<MessageSquare />} accent="var(--green, #34d399)" hint={`${metrics.replies} replies`} />
        <StatCard label="Positive response rate" value={`${metrics.positiveRate}%`} icon={<ThumbsUp />} accent="var(--green, #34d399)" hint={`${metrics.positiveReplies} positive`} />
        <StatCard label="Meetings booked" value={metrics.meetingsBooked} icon={<CalendarCheck />} accent="var(--ac2)" />
        <StatCard label="Proposals sent" value={metrics.proposalsSent} icon={<FileText />} accent="var(--orange, #fb923c)" />
        <StatCard label="Conversion rate" value={`${metrics.conversionRate}%`} icon={<TrendingUp />} hint="contacted → meeting" />
        <StatCard label="Deals won" value={metrics.won} icon={<Trophy />} accent="var(--orange, #fb923c)" hint={`${metrics.qualified} qualified`} />
        <StatCard label="Pipeline value" value={`€${Math.round(metrics.pipelineValue).toLocaleString("en-IE")}`} icon={<Euro />} accent="var(--green, #34d399)" />
      </div>

      <div className="grid-2" style={{ marginTop: 24 }}>
        <section className="panel panel-block" aria-labelledby="an-channels">
          <h2 className="panel-title" id="an-channels">
            Outreach by channel
          </h2>
          {metrics.outreachSent === 0 ? (
            <p className="empty-state">No outreach sent in this window.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Channel</th>
                    <th>Sent</th>
                    <th>Share</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(metrics.outreachByChannel)
                    .sort((a, b) => b[1] - a[1])
                    .map(([channel, count]) => (
                      <tr key={channel}>
                        <td>{CHANNEL_META[channel as Channel]?.label ?? channel}</td>
                        <td>{count}</td>
                        <td>{Math.round((count / metrics.outreachSent) * 100)}%</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel panel-block" aria-labelledby="an-industries">
          <h2 className="panel-title" id="an-industries">
            Top-performing industries
          </h2>
          {metrics.topIndustries.length === 0 ? (
            <p className="empty-state">No prospect data yet.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Industry</th>
                    <th>Prospects</th>
                    <th>Sent</th>
                    <th>Replies</th>
                    <th>Meetings</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.topIndustries.slice(0, 10).map((i) => (
                    <tr key={i.industry}>
                      <td>{i.industry}</td>
                      <td>{i.prospects}</td>
                      <td>{i.sent}</td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {i.replies}
                        {/* "Top-performing" only means something with the rate:
                            10 sent / 3 replies beats 100 / 5. Show it inline so
                            the niche to scrape next is obvious. Shown once
                            anything's been sent; the Sent column gives the
                            sample size for judging a small-N rate. */}
                        {i.sent > 0 && (
                          <span style={{ color: "var(--faint)", fontSize: 11 }}>
                            {" "}
                            ({Math.round((i.replies / i.sent) * 100)}%)
                          </span>
                        )}
                      </td>
                      <td>{i.meetings}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {/* Prospects is a lifetime count (it comes from the full prospect
              set); Sent/Replies/Meetings honour the window above. Flag it only
              when a window is active, so "12 prospects · 2 sent" doesn't read as
              a barely-worked niche when the 12 is all-time. */}
          {days !== null && metrics.topIndustries.length > 0 && (
            <p style={{ fontSize: 11.5, color: "var(--faint)", margin: "8px 0 0" }}>
              Prospects is an all-time total; Sent, Replies and Meetings are for the selected period.
            </p>
          )}
        </section>
      </div>

      <div className="grid-2" style={{ marginTop: 20 }}>
        <section className="panel panel-block" aria-labelledby="an-solutions">
          <h2 className="panel-title" id="an-solutions">
            Most recommended solutions
          </h2>
          {metrics.topSolutions.length === 0 ? (
            <p className="empty-state">Run company research to populate this.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Solution</th>
                    <th>Recommended</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.topSolutions.map((s) => (
                    <tr key={s.name}>
                      <td>{s.name}</td>
                      <td>{s.count}×</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel panel-block" aria-labelledby="an-tones">
          <h2 className="panel-title" id="an-tones">
            Best performing outreach style
          </h2>
          {metrics.toneStats.length === 0 ? (
            <p className="empty-state">
              Send outreach from the Message Studio to see which tone gets
              replies.
            </p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Tone</th>
                    <th>Sent</th>
                    <th>Got a reply</th>
                    <th>Reply rate</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.toneStats.map((t) => (
                    <tr key={t.tone}>
                      <td style={{ textTransform: "capitalize" }}>{t.tone}</td>
                      <td>{t.sent}</td>
                      <td>{t.replied}</td>
                      <td>
                        {t.replyRate}%
                        {/* A rate off a handful of sends is noise — a 1/1 = 100%
                            would otherwise read as the "best style". Flag it so
                            the ranking isn't trusted before there's real data. */}
                        {t.sent < 10 && (
                          <span
                            style={{ color: "var(--faint)", fontSize: 11, marginLeft: 6 }}
                            title="Too few sends to be reliable yet"
                          >
                            small sample
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <section className="panel panel-block" style={{ marginTop: 20 }} aria-labelledby="an-campaigns">
        <h2 className="panel-title" id="an-campaigns">
          Top-performing campaigns <Link href="/growth/campaigns">Manage →</Link>
        </h2>
        {metrics.topCampaigns.length === 0 ? (
          <p className="empty-state">No campaign activity yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Prospects</th>
                  <th>Sent</th>
                  <th>Replies</th>
                  <th>Reply rate</th>
                  <th>Qualified</th>
                  <th>Meetings</th>
                </tr>
              </thead>
              <tbody>
                {metrics.topCampaigns.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/growth/campaigns/${c.id}`}>{c.name}</Link>
                    </td>
                    <td>{c.prospects}</td>
                    <td>{c.sent}</td>
                    <td>{c.replies}</td>
                    <td>{c.sent > 0 ? Math.round((c.replies / c.sent) * 100) : 0}%</td>
                    <td>{c.qualified}</td>
                    <td>{c.meetings}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {days !== null && metrics.topCampaigns.length > 0 && (
          <p style={{ fontSize: 11.5, color: "var(--faint)", margin: "8px 0 0" }}>
            Prospects and Qualified are all-time totals; Sent, Replies and Meetings are for the selected period.
          </p>
        )}
      </section>

      {/* CSV exports — folded in from the old Reports page so all the numbers
          (view + download) live in one place. The export route only spans
          7/30/90 days, so "All time" downloads the widest window (90d);
          the prospect export is always the full database. */}
      <section className="panel panel-block" style={{ marginTop: 20 }} aria-labelledby="an-exports">
        <h2 className="panel-title" id="an-exports">
          CSV exports
        </h2>
        <p style={{ fontSize: 13, color: "var(--faint)", marginTop: 0 }}>
          Downloads reflect the selected period{days === null ? " (all-time views export the last 90 days)" : ""} — the prospect export is always the full database.
        </p>
        <div style={{ display: "grid", gap: 8 }}>
          <a className="btn btn-secondary" href={`/growth/reports/export?type=summary&days=${days ?? 90}`}>
            <Download size={14} /> Summary report
          </a>
          <a className="btn btn-secondary" href="/growth/reports/export?type=prospects">
            <Download size={14} /> Prospect database
          </a>
          <a className="btn btn-secondary" href={`/growth/reports/export?type=messages&days=${days ?? 90}`}>
            <Download size={14} /> Messages &amp; replies
          </a>
          <a className="btn btn-secondary" href={`/growth/reports/export?type=meetings&days=${days ?? 90}`}>
            <Download size={14} /> Meetings
          </a>
        </div>
      </section>
    </>
  );
}
