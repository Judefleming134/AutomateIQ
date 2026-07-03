import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";

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
    <main style={{ padding: 40 }}>
      <h1>Review Agent</h1>
      <p>Send review requests and grow your online reputation.</p>

      <div style={{ display: "flex", gap: 16, margin: "24px 0" }}>
        <StatCard label="Review Requests" value={totalSent ?? 0} />
        <StatCard label="Pending Follow-ups" value={pendingFollowUps ?? 0} />
      </div>

      <h2>Recent Activity</h2>
      <ul>
        {(recent ?? []).map((r) => {
          const customer = r.ra_customers as unknown as { name: string } | null;
          return (
            <li key={r.id}>
              {r.status} — {customer?.name ?? "unknown"} (
              {new Date(r.created_at).toLocaleString()})
            </li>
          );
        })}
      </ul>
      {(recent ?? []).length === 0 && (
        <p style={{ fontStyle: "italic" }}>No activity yet.</p>
      )}
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div
      style={{
        border: "1px solid var(--line)",
        borderRadius: 12,
        padding: 16,
        background: "var(--panel)",
        minWidth: 140,
      }}
    >
      <div style={{ fontSize: 24, fontWeight: 700, color: "var(--heading)" }}>
        {value}
      </div>
      <div style={{ fontSize: 13 }}>{label}</div>
    </div>
  );
}
