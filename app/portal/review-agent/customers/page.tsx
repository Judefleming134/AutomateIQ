import Link from "next/link";
import { Send } from "lucide-react";
import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";

export default async function ReviewAgentCustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireSession();
  const supabase = await createClient();
  const { q = "" } = await searchParams;

  // RLS scopes all of these to the caller's own business automatically.
  let customerQuery = supabase
    .from("ra_customers")
    .select("id, name, email, created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (q.trim()) {
    customerQuery = customerQuery.or(
      `name.ilike.%${q.trim()}%,email.ilike.%${q.trim()}%`
    );
  }
  const { data: customers } = await customerQuery;

  // Per-customer request + click counts for the visible rows — one batched
  // query, counted in memory.
  const requestsByCustomer = new Map<string, { total: number; clicked: number }>();
  const ids = (customers ?? []).map((c) => c.id);
  if (ids.length > 0) {
    const { data: reqRows } = await supabase
      .from("ra_review_requests")
      .select("ra_customer_id, status")
      .in("ra_customer_id", ids)
      .limit(2000);
    for (const row of reqRows ?? []) {
      const entry =
        requestsByCustomer.get(row.ra_customer_id) ?? { total: 0, clicked: 0 };
      entry.total += 1;
      if (row.status === "clicked") entry.clicked += 1;
      requestsByCustomer.set(row.ra_customer_id, entry);
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Customers</h1>
          <p>Everyone you&apos;ve sent a review request to.</p>
        </div>
        <Link href="/portal/review-agent/send" className="btn btn-primary">
          <Send size={15} /> Send request
        </Link>
      </div>

      <form method="get" className="search-bar">
        <input
          type="text"
          name="q"
          placeholder="Search by name or email…"
          defaultValue={q}
        />
        <button type="submit" className="btn btn-secondary">
          Search
        </button>
      </form>

      <div className="table-wrap">
        {(customers ?? []).length === 0 ? (
          <p className="empty-state">
            {q.trim()
              ? "No customers match that search."
              : "No customers yet — send your first review request to get started."}
          </p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Requests</th>
                <th>Clicked</th>
                <th>Added</th>
              </tr>
            </thead>
            <tbody>
              {(customers ?? []).map((c) => {
                const stats = requestsByCustomer.get(c.id);
                return (
                  <tr key={c.id}>
                    <td style={{ color: "var(--heading)", fontWeight: 600 }}>
                      {c.name}
                    </td>
                    <td>{c.email}</td>
                    <td>{stats?.total ?? 0}</td>
                    <td>
                      {(stats?.clicked ?? 0) > 0 ? (
                        <span className="badge badge-green">
                          {stats!.clicked} click{stats!.clicked === 1 ? "" : "s"}
                        </span>
                      ) : (
                        <span style={{ color: "var(--faint)" }}>—</span>
                      )}
                    </td>
                    <td>
                      {new Date(c.created_at).toLocaleDateString("en-IE", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </td>
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
