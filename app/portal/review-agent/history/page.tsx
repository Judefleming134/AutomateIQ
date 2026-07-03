import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  sent: "Sent",
  reminded: "Reminder sent",
  clicked: "Clicked",
  failed: "Failed",
};

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
    <main style={{ padding: 40 }}>
      <h1>History</h1>
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 16 }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>Customer</th>
            <th style={{ textAlign: "left" }}>Status</th>
            <th style={{ textAlign: "left" }}>Sent</th>
            <th style={{ textAlign: "left" }}>Reminder</th>
            <th style={{ textAlign: "left" }}>Clicked</th>
          </tr>
        </thead>
        <tbody>
          {(requests ?? []).map((r) => {
            const customer = r.ra_customers as unknown as { name: string; email: string } | null;
            return (
              <tr key={r.id}>
                <td>{customer?.name ?? "—"}</td>
                <td>{STATUS_LABEL[r.status] ?? r.status}</td>
                <td>{r.sent_at ? new Date(r.sent_at).toLocaleString() : "—"}</td>
                <td>{r.reminder_sent_at ? new Date(r.reminder_sent_at).toLocaleString() : "—"}</td>
                <td>{r.clicked_at ? new Date(r.clicked_at).toLocaleString() : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {(requests ?? []).length === 0 && (
        <p style={{ fontStyle: "italic", marginTop: 16 }}>No review requests sent yet.</p>
      )}
    </main>
  );
}
