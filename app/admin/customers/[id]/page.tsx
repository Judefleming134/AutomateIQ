import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  setBusinessStatus,
  softDeleteBusiness,
  resetUserPassword,
  setProductEnabled,
} from "../actions";
import { ActionForm } from "@/components/admin/action-form";

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
    <main style={{ padding: 40, maxWidth: 700 }}>
      <h1>{business.name}</h1>
      <p>Status: {business.status}</p>

      <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
        {business.status === "active" ? (
          <ActionForm action={suspend}>
            <button type="submit">Suspend</button>
          </ActionForm>
        ) : (
          <ActionForm action={unsuspend}>
            <button type="submit">Reactivate</button>
          </ActionForm>
        )}
        <ActionForm action={remove}>
          <button type="submit">Delete</button>
        </ActionForm>
      </div>

      <h2>Users</h2>
      <ul>
        {usersWithEmail.map((u) => {
          async function reset(_p: unknown, _f: FormData) {
            "use server";
            return resetUserPassword(u.id, u.email);
          }
          return (
            <li key={u.id}>
              {u.email} ({u.role}){" "}
              <ActionForm action={reset} className="inline-form">
                <button type="submit">Send password reset</button>
              </ActionForm>
            </li>
          );
        })}
      </ul>

      <h2>Products</h2>
      <ul>
        {(products ?? []).map((p) => {
          const isEnabled = enabledProductIds.has(p.id);
          async function toggle(_prev: unknown, _f: FormData) {
            "use server";
            return setProductEnabled(id, p.id, !isEnabled);
          }
          return (
            <li key={p.id}>
              {p.name} — {isEnabled ? "enabled" : "disabled"}{" "}
              <ActionForm action={toggle} className="inline-form">
                <button type="submit">{isEnabled ? "Remove" : "Assign"}</button>
              </ActionForm>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
