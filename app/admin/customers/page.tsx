import Link from "next/link";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { createCustomer } from "./actions";
import { ActionForm } from "@/components/admin/action-form";

const PAGE_SIZE = 25;

export default async function AdminCustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  await requireAdmin();
  const { q = "", page: pageParam } = await searchParams;
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const supabase = createAdminClient();
  let query = supabase
    .from("businesses")
    .select("id, name, status, created_at", { count: "exact" })
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (q.trim()) {
    query = query.ilike("name", `%${q.trim()}%`);
  }

  const { data: businesses, count } = await query;
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  return (
    <main style={{ padding: 40, maxWidth: 900 }}>
      <h1>Customers</h1>

      <form method="get" style={{ marginBottom: 20 }}>
        <input
          type="text"
          name="q"
          placeholder="Search by business name…"
          defaultValue={q}
        />
        <button type="submit">Search</button>
      </form>

      <details style={{ marginBottom: 24 }}>
        <summary>+ New customer</summary>
        <ActionForm action={createCustomer} className="create-customer-form">
          <label>
            Business name
            <input type="text" name="businessName" required />
          </label>
          <label>
            Owner email
            <input type="email" name="email" required />
          </label>
          <button type="submit">Create &amp; send invite</button>
        </ActionForm>
      </details>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>Business</th>
            <th style={{ textAlign: "left" }}>Status</th>
            <th style={{ textAlign: "left" }}>Created</th>
          </tr>
        </thead>
        <tbody>
          {(businesses ?? []).map((b) => (
            <tr key={b.id}>
              <td>
                <Link href={`/admin/customers/${b.id}`}>{b.name}</Link>
              </td>
              <td>{b.status}</td>
              <td>{new Date(b.created_at).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        {page > 1 && (
          <Link href={`/admin/customers?q=${encodeURIComponent(q)}&page=${page - 1}`}>
            ← Previous
          </Link>
        )}
        <span>
          Page {page} of {totalPages}
        </span>
        {page < totalPages && (
          <Link href={`/admin/customers?q=${encodeURIComponent(q)}&page=${page + 1}`}>
            Next →
          </Link>
        )}
      </div>
    </main>
  );
}
