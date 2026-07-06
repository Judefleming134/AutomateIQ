import Link from "next/link";
import { Download } from "lucide-react";
import { requireGrowth } from "@/lib/growth/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadGrowthMetrics } from "@/lib/growth/metrics";

const WINDOWS = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
] as const;

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  await requireGrowth();
  const params = await searchParams;
  const days = [7, 30, 90].includes(Number(params.days)) ? Number(params.days) : 30;

  const admin = createAdminClient();
  const metrics = await loadGrowthMetrics(admin, days);

  const summaryRows: [string, string | number][] = [
    ["Leads added", metrics.leadsAdded],
    ["Prospects total", metrics.prospectsTotal],
    ["Outreach sent", metrics.outreachSent],
    ["Prospects contacted", metrics.contacted],
    ["Replies received", metrics.replies],
    ["Reply rate", `${metrics.replyRate}%`],
    ["Positive response rate", `${metrics.positiveRate}%`],
    ["Meetings booked", metrics.meetingsBooked],
    ["Conversion rate (contacted → meeting)", `${metrics.conversionRate}%`],
    ["Qualified leads", metrics.qualified],
    ["Deals won", metrics.won],
    ["Pipeline value", `€${Math.round(metrics.pipelineValue).toLocaleString("en-IE")}`],
    ["Outreach in queue", metrics.queuedOutreach],
    ["Outreach in draft", metrics.draftOutreach],
  ];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Reporting</h1>
          <p>
            Period summaries and CSV exports for record-keeping or a
            spreadsheet deep-dive.
          </p>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {WINDOWS.map((w) => (
            <Link
              key={w.days}
              href={`/growth/reports?days=${w.days}`}
              className={`btn btn-sm ${days === w.days ? "btn-primary" : "btn-secondary"}`}
            >
              {w.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="grid-main-side">
        <section className="panel panel-block" aria-labelledby="rp-summary">
          <h2 className="panel-title" id="rp-summary">
            Last {days} days at a glance
          </h2>
          <div className="table-wrap">
            <table>
              <tbody>
                {summaryRows.map(([label, value]) => (
                  <tr key={label}>
                    <td>{label}</td>
                    <td style={{ textAlign: "right", fontWeight: 600 }}>{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel panel-block" aria-labelledby="rp-exports">
          <h2 className="panel-title" id="rp-exports">
            CSV exports
          </h2>
          <p style={{ fontSize: 13, color: "var(--faint)", marginTop: 0 }}>
            Downloads reflect the selected period (prospects export is always
            the full database).
          </p>
          <div style={{ display: "grid", gap: 8 }}>
            <a className="btn btn-secondary" href={`/growth/reports/export?type=summary&days=${days}`}>
              <Download size={14} /> Summary report
            </a>
            <a className="btn btn-secondary" href="/growth/reports/export?type=prospects">
              <Download size={14} /> Prospect database
            </a>
            <a className="btn btn-secondary" href={`/growth/reports/export?type=messages&days=${days}`}>
              <Download size={14} /> Messages &amp; replies
            </a>
            <a className="btn btn-secondary" href={`/growth/reports/export?type=meetings&days=${days}`}>
              <Download size={14} /> Meetings
            </a>
          </div>
        </section>
      </div>
    </>
  );
}
