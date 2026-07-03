import { Send, Clock3 } from "lucide-react";
import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";
import { StatCard } from "@/components/portal/stat-card";
import { StatusBadge } from "@/components/portal/status-badge";

export default async function ReviewAgentOverviewPage() {
  await requireSession();
  const supabase = await createClient();

  // RLS scopes every one of these to the caller's own business.
  const [{ count: totalSent }, { count: pendingFollowUps }, { data: recent }] =
    await Promise.all([
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
        .select("id, status, created_at, ra_customers(name)")
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Review Agent</h1>
          <p>Send review requests and grow your online reputation.</p>
        </div>
      </div>

      <div className="stat-grid">
        <StatCard
          label="Review Requests"
          value={totalSent ?? 0}
          icon={<Send />}
          accent="#7C3AED"
        />
        <StatCard
          label="Pending Follow-ups"
          value={pendingFollowUps ?? 0}
          icon={<Clock3 />}
          accent="#FB923C"
        />
      </div>

      <h2 style={{ fontSize: 16, marginBottom: 14 }}>Recent Activity</h2>
      <div className="table-wrap">
        {(recent ?? []).length === 0 ? (
          <p className="empty-state">No activity yet.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Status</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {(recent ?? []).map((r) => {
                const customer = r.ra_customers as unknown as { name: string } | null;
                return (
                  <tr key={r.id}>
                    <td>{customer?.name ?? "unknown"}</td>
                    <td>
                      <StatusBadge status={r.status} />
                    </td>
                    <td>{new Date(r.created_at).toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
