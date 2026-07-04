import Link from "next/link";
import { Send, Clock3, MousePointerClick, TrendingUp } from "lucide-react";
import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";
import { StatCard } from "@/components/portal/stat-card";
import { StatusBadge } from "@/components/portal/status-badge";
import {
  ActivityBarChart,
  bucketByDay,
} from "@/components/portal/activity-chart";

const CHART_DAYS = 14;

export default async function ReviewAgentOverviewPage() {
  await requireSession();
  const supabase = await createClient();

  const chartSince = new Date(
    Date.now() - (CHART_DAYS - 1) * 86_400_000
  ).toISOString();

  // RLS scopes every one of these to the caller's own business.
  const [
    { count: totalSent },
    { count: pendingFollowUps },
    { count: totalClicked },
    { data: recent },
    { data: chartRows },
  ] = await Promise.all([
    supabase
      .from("ra_review_requests")
      .select("id", { count: "exact", head: true })
      .in("status", ["sent", "reminded", "clicked"]),
    supabase
      .from("ra_review_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "sent"),
    supabase
      .from("ra_review_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "clicked"),
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

  const sent = totalSent ?? 0;
  const clicked = totalClicked ?? 0;
  const clickRate = sent > 0 ? `${Math.round((clicked / sent) * 100)}%` : "—";

  const buckets = bucketByDay(
    (chartRows ?? []).map((r) => r.created_at),
    CHART_DAYS
  );

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Review Agent</h1>
          <p>Send review requests and grow your online reputation.</p>
        </div>
        <Link href="/portal/review-agent/send" className="btn btn-primary">
          <Send size={15} /> Send request
        </Link>
      </div>

      <div className="stat-grid">
        <StatCard
          label="Review requests"
          value={sent}
          icon={<Send />}
          accent="#7C3AED"
          hint="all time"
        />
        <StatCard
          label="Pending follow-ups"
          value={pendingFollowUps ?? 0}
          icon={<Clock3 />}
          accent="#FB923C"
          hint="reminder in 3 days"
        />
        <StatCard
          label="Link clicks"
          value={clicked}
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
          <h2 className="panel-title">Requests — last {CHART_DAYS} days</h2>
          <ActivityBarChart buckets={buckets} accent="#7C3AED" />
        </div>

        <div className="panel panel-block">
          <h2 className="panel-title">
            Recent activity
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
      </div>
    </>
  );
}
