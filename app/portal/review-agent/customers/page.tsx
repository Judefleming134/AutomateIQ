import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";

export default async function ReviewAgentCustomersPage() {
  await requireSession();
  const supabase = await createClient();

  // RLS scopes this to the caller's own business automatically.
  const { data: customers } = await supabase
    .from("ra_customers")
    .select("id, name, email, created_at")
    .order("created_at", { ascending: false });

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Customers</h1>
          <p>Everyone you&apos;ve sent a review request to.</p>
        </div>
      </div>

      <div className="table-wrap">
        {(customers ?? []).length === 0 ? (
          <p className="empty-state">
            No customers yet — send your first review request to get started.
          </p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Added</th>
              </tr>
            </thead>
            <tbody>
              {(customers ?? []).map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{c.email}</td>
                  <td>{new Date(c.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
