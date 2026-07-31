import Link from "next/link";
import { Send, Clock3, MousePointerClick, TrendingUp } from "lucide-react";
import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";
import { StatCard } from "@/components/portal/stat-card";
import { StatusBadge } from "@/components/portal/status-badge";
import {
  ActivityBarChart,
  DonutChart,
  bucketByDay,
} from "@/components/portal/activity-chart";

const CHART_DAYS = 14;

// Status palette — states, not series: each status keeps its badge hue.
const STATUS_COLORS = {
  pending: "#6b7280",
  sent: "var(--chart-2)",
  reminded: "var(--chart-5)",
  clicked: "var(--chart-4)",
  failed: "#dc2626",
};

export default async function ReviewAgentOverviewPage() {
  await requireSession();
  const supabase = await createClient();

  const chartSince = new Date(
    Date.now() - (CHART_DAYS - 1) * 86_400_000
  ).toISOString();

  const countByStatus = (status: string) =>
    supabase
      .from("ra_review_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", status);

  // RLS scopes every one of these to the caller's own business.
  const [
    { count: pending },
    { count: sent },
    { count: reminded },
    { count: clicked },
    { count: failed },
    { data: recent },
    { data: chartRows },
  ] = await Promise.all([
    countByStatus("pending"),
    countByStatus("sent"),
    countByStatus("reminded"),
    countByStatus("clicked"),
    countByStatus("failed"),
    supabase
      .from("ra_review_requests")
      .select("id, status, created_at, ra_customers(name)")
      .order("created_at", { ascending: false })
      .limit(6),
    supabase
      .from("ra_review_requests")
      .select("created_at")
      .gte("created_at", chartSince)
      .limit(1000),
  ]);

  const delivered = (sent ?? 0) + (reminded ?? 0) + (clicked ?? 0);
  // The headline "Review requests" count is every request made, matching the
  // status donut's centre total (which sums all five states). Using `delivered`
  // here left the card and the donut showing two different "requests" totals on
  // the same screen whenever anything was still pending or had failed.
  const totalRequests =
    (pending ?? 0) + (sent ?? 0) + (reminded ?? 0) + (clicked ?? 0) + (failed ?? 0);
  const clickRate =
    delivered > 0 ? `${Math.round(((clicked ?? 0) / delivered) * 100)}%` : "—";

  const buckets = bucketByDay(
    (chartRows ?? []).map((r) => r.created_at),
    CHART_DAYS
  );

  return (
    <>
      <div className="page-header">
        <div>
          <h1>ReputationIQ</h1>
          <p>Send review requests and grow your online reputation.</p>
        </div>
        <Link href="/portal/review-agent/send" className="btn btn-primary">
          <Send size={15} /> Send request
        </Link>
      </div>

      <div className="stat-grid">
        <StatCard
          label="Review requests"
          value={totalRequests}
          icon={<Send />}
          accent="#7C3AED"
          hint="all time"
        />
        <StatCard
          label="Pending follow-ups"
          value={sent ?? 0}
          icon={<Clock3 />}
          accent="#FB923C"
          hint="reminder in 3 days"
        />
        <StatCard
          label="Link clicks"
          value={clicked ?? 0}
          icon={<MousePointerClick />}
          accent="#22D3EE"
          hint="all time"
        />
        <StatCard
          label="Click rate"
          value={clickRate}
          icon={<TrendingUp />}
          accent="#34D399"
        />
      </div>

      <div className="grid-main-side">
        <div className="panel panel-block">
          <h2 className="panel-title">
            <span>
              <span className="sys-index">01 /</span>
              Requests — last {CHART_DAYS} days
            </span>
          </h2>
          <ActivityBarChart buckets={buckets} accent="var(--chart-1)" />
        </div>

        <div className="panel panel-block">
          <h2 className="panel-title">
            <span>
              <span className="sys-index">02 /</span>
              Request status
            </span>
          </h2>
          <DonutChart
            centerLabel="requests"
            emptyText="No requests yet."
            segments={[
              { label: "Clicked", count: clicked ?? 0, color: STATUS_COLORS.clicked },
              { label: "Sent", count: sent ?? 0, color: STATUS_COLORS.sent },
              { label: "Reminded", count: reminded ?? 0, color: STATUS_COLORS.reminded },
              { label: "Pending", count: pending ?? 0, color: STATUS_COLORS.pending },
              { label: "Failed", count: failed ?? 0, color: STATUS_COLORS.failed },
            ]}
          />
        </div>
      </div>

      <div className="panel panel-block">
        <h2 className="panel-title">
          <span>
            <span className="sys-index">03 /</span>
            Recent activity
          </span>
          <Link href="/portal/review-agent/history">View all →</Link>
        </h2>
        {(recent ?? []).length === 0 ? (
          <p className="empty-state">No activity yet.</p>
        ) : (
          <ul className="feed-list">
            {(recent ?? []).map((r) => {
              const customer = r.ra_customers as unknown as {
                name: string;
              } | null;
              return (
                <li key={r.id}>
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      minWidth: 0,
                    }}
                  >
                    <StatusBadge status={r.status} />
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {customer?.name ?? "unknown"}
                    </span>
                  </span>
                  <span className="feed-time">
                    {new Date(r.created_at).toLocaleDateString("en-IE", {
                      day: "numeric",
                      month: "short",
                    })}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
