import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";
import { StatusBadge } from "@/components/portal/status-badge";

// Format timestamps in Irish time — bare toLocaleString() rendered in the
// server's locale/timezone (US format, UTC), so an Irish customer saw the
// wrong format an hour off. Match the rest of the app (en-IE / Europe/Dublin).
function fmt(ts: string | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-IE", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Dublin",
  });
}

export default async function ReviewAgentHistoryPage() {
  await requireSession();
  const supabase = await createClient();

  // RLS scopes this to the caller's own business automatically.
  const { data: requests } = await supabase
    .from("ra_review_requests")
    .select("id, status, sent_at, reminder_sent_at, clicked_at, created_at, ra_customers(name, email)")
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>History</h1>
          <p>Every review request sent, reminded and clicked.</p>
        </div>
      </div>

      <div className="table-wrap">
        {(requests ?? []).length === 0 ? (
          <p className="empty-state">No review requests sent yet.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Status</th>
                <th>Sent</th>
                <th>Reminder</th>
                <th>Clicked</th>
              </tr>
            </thead>
            <tbody>
              {(requests ?? []).map((r) => {
                const customer = r.ra_customers as unknown as { name: string; email: string } | null;
                return (
                  <tr key={r.id}>
                    <td>{customer?.name ?? "—"}</td>
                    <td>
                      <StatusBadge status={r.status} />
                    </td>
                    <td>{fmt(r.sent_at)}</td>
                    <td>{fmt(r.reminder_sent_at)}</td>
                    <td>{fmt(r.clicked_at)}</td>
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
