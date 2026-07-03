import { notFound } from "next/navigation";
import { KeyRound } from "lucide-react";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  setBusinessStatus,
  softDeleteBusiness,
  resetUserPassword,
  setProductEnabled,
} from "../actions";
import { ActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/admin/submit-button";

export default async function AdminCustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const supabase = createAdminClient();

  const { data: business } = await supabase
    .from("businesses")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!business) notFound();

  const [{ data: users }, { data: products }, { data: enabled }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("id, role, created_at")
        .eq("business_id", id),
      supabase.from("products").select("id, key, name, status"),
      supabase.from("business_products").select("product_id").eq("business_id", id),
    ]);

  // profiles has no email column (that lives on auth.users) — fetch emails
  // via the admin API for the small number of users on this business.
  const usersWithEmail = await Promise.all(
    (users ?? []).map(async (u) => {
      const { data } = await supabase.auth.admin.getUserById(u.id);
      return { ...u, email: data.user?.email ?? "(unknown)" };
    })
  );

  const enabledProductIds = new Set((enabled ?? []).map((e) => e.product_id));

  // useActionState requires action: (prevState, formData) => result — these
  // capture `id` (and, per-item, the loop variable) via closure.
  async function suspend(_p: unknown, _f: FormData) {
    "use server";
    return setBusinessStatus(id, "suspended");
  }
  async function unsuspend(_p: unknown, _f: FormData) {
    "use server";
    return setBusinessStatus(id, "active");
  }
  async function remove(_p: unknown, _f: FormData) {
    "use server";
    return softDeleteBusiness(id);
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{business.name}</h1>
          <span className={`badge ${business.status === "active" ? "badge-green" : "badge-orange"}`}>
            {business.status}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {business.status === "active" ? (
            <ActionForm action={suspend} className="inline-form">
              <SubmitButton className="btn btn-secondary" pendingText="Suspending…">
                Suspend
              </SubmitButton>
            </ActionForm>
          ) : (
            <ActionForm action={unsuspend} className="inline-form">
              <SubmitButton className="btn btn-secondary" pendingText="Reactivating…">
                Reactivate
              </SubmitButton>
            </ActionForm>
          )}
          <ActionForm action={remove} className="inline-form">
            <SubmitButton className="btn btn-danger" pendingText="Deleting…">
              Delete
            </SubmitButton>
          </ActionForm>
        </div>
      </div>

      <h2 style={{ fontSize: 16, marginBottom: 14 }}>Users</h2>
      <div className="table-wrap" style={{ marginBottom: 32 }}>
        {usersWithEmail.length === 0 ? (
          <p className="empty-state">No users yet.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {usersWithEmail.map((u) => {
                async function reset(_p: unknown, _f: FormData) {
                  "use server";
                  return resetUserPassword(u.id, u.email);
                }
                return (
                  <tr key={u.id}>
                    <td>{u.email}</td>
                    <td>{u.role}</td>
                    <td>
                      <ActionForm action={reset} className="inline-form">
                        <SubmitButton className="btn btn-secondary btn-sm" pendingText="Sending…">
                          <KeyRound size={13} /> Reset password
                        </SubmitButton>
                      </ActionForm>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <h2 style={{ fontSize: 16, marginBottom: 14 }}>Products</h2>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Product</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(products ?? []).map((p) => {
              const isEnabled = enabledProductIds.has(p.id);
              async function toggle(_prev: unknown, _f: FormData) {
                "use server";
                return setProductEnabled(id, p.id, !isEnabled);
              }
              return (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>
                    <span className={`badge ${isEnabled ? "badge-green" : "badge-gray"}`}>
                      {isEnabled ? "Enabled" : "Disabled"}
                    </span>
                  </td>
                  <td>
                    <ActionForm action={toggle} className="inline-form">
                      <SubmitButton
                        className={`btn btn-sm ${isEnabled ? "btn-danger" : "btn-primary"}`}
                        pendingText="Saving…"
                      >
                        {isEnabled ? "Remove" : "Assign"}
                      </SubmitButton>
                    </ActionForm>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
