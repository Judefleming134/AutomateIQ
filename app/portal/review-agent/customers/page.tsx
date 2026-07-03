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
    <main style={{ padding: 40 }}>
      <h1>Customers</h1>
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 16 }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>Name</th>
            <th style={{ textAlign: "left" }}>Email</th>
            <th style={{ textAlign: "left" }}>Added</th>
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
      {(customers ?? []).length === 0 && (
        <p style={{ fontStyle: "italic", marginTop: 16 }}>
          No customers yet — send your first review request to get started.
        </p>
      )}
    </main>
  );
}
