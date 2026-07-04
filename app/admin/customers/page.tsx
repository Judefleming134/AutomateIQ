import Link from "next/link";
import { Plus } from "lucide-react";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { createCustomer } from "./actions";
import { ActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/admin/submit-button";

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

  const [{ data: businesses, count }, { data: assignableProducts }] =
    await Promise.all([
      query,
      supabase
        .from("products")
        .select("key, name, status")
        .in("status", ["active"])
        .order("name"),
    ]);
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  // Enrich the visible page with enabled products + user counts — two
  // batched queries over just this page's ids, not N+1.
  const pageIds = (businesses ?? []).map((b) => b.id);
  const productsByBusiness = new Map<string, string[]>();
  const usersByBusiness = new Map<string, number>();
  if (pageIds.length > 0) {
    const [{ data: bpRows }, { data: profileRows }] = await Promise.all([
      supabase
        .from("business_products")
        .select("business_id, products(name)")
        .in("business_id", pageIds),
      supabase.from("profiles").select("business_id").in("business_id", pageIds),
    ]);
    for (const row of bpRows ?? []) {
      const name = (row.products as unknown as { name: string } | null)?.name;
      if (!name) continue;
      const list = productsByBusiness.get(row.business_id) ?? [];
      list.push(name);
      productsByBusiness.set(row.business_id, list);
    }
    for (const row of profileRows ?? []) {
      usersByBusiness.set(
        row.business_id,
        (usersByBusiness.get(row.business_id) ?? 0) + 1
      );
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Customers</h1>
          <p>{count ?? 0} businesses on the platform.</p>
        </div>
      </div>

      <form method="get" className="search-bar">
        <input type="text" name="q" placeholder="Search by business name…" defaultValue={q} />
        <button type="submit" className="btn btn-secondary">
          Search
        </button>
      </form>

      <details className="disclosure">
        <summary>
          <Plus size={14} /> New customer
        </summary>
        <ActionForm action={createCustomer} className="panel form-card">
          <div className="field">
            <label htmlFor="businessName">Business name</label>
            <input id="businessName" type="text" name="businessName" required />
          </div>
          <div className="field">
            <label htmlFor="email">Owner email</label>
            <input id="email" type="email" name="email" required />
          </div>
          <div className="field">
            <label>Products to enable</label>
            {(assignableProducts ?? []).map((p) => (
              <label
                key={p.key}
                htmlFor={`product-${p.key}`}
                style={{
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  margin: 0,
                  fontSize: 13.5,
                  color: "var(--heading)",
                }}
              >
                <input
                  id={`product-${p.key}`}
                  type="checkbox"
                  name="products"
                  value={p.key}
                  defaultChecked={p.key === "review-agent"}
                  style={{ width: 15, height: 15 }}
                />
                {p.name}
              </label>
            ))}
          </div>
          <div className="form-actions">
            <SubmitButton pendingText="Creating…">Create &amp; send invite</SubmitButton>
          </div>
        </ActionForm>
      </details>

      <div className="table-wrap">
        {(businesses ?? []).length === 0 ? (
          <p className="empty-state">No customers found.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Business</th>
                <th>Status</th>
                <th>Products</th>
                <th>Users</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {(businesses ?? []).map((b) => {
                const productNames = productsByBusiness.get(b.id) ?? [];
                return (
                  <tr key={b.id}>
                    <td>
                      <Link href={`/admin/customers/${b.id}`}>{b.name}</Link>
                    </td>
                    <td>
                      <span className={`badge ${b.status === "active" ? "badge-green" : "badge-orange"}`}>
                        {b.status}
                      </span>
                    </td>
                    <td>
                      {productNames.length === 0 ? (
                        <span style={{ color: "var(--faint)", fontSize: 12 }}>—</span>
                      ) : (
                        <span className="product-chips">
                          {productNames.map((name) => (
                            <span key={name}>{name}</span>
                          ))}
                        </span>
                      )}
                    </td>
                    <td>{usersByBusiness.get(b.id) ?? 0}</td>
                    <td>{new Date(b.created_at).toLocaleDateString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="pagination">
        {page > 1 && (
          <Link href={`/admin/customers?q=${encodeURIComponent(q)}&page=${page - 1}`}>← Previous</Link>
        )}
        <span>
          Page {page} of {totalPages}
        </span>
        {page < totalPages && (
          <Link href={`/admin/customers?q=${encodeURIComponent(q)}&page=${page + 1}`}>Next →</Link>
        )}
      </div>
    </>
  );
}
