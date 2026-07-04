import { notFound } from "next/navigation";
import { KeyRound, FileText } from "lucide-react";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  setBusinessStatus,
  softDeleteBusiness,
  resetUserPassword,
  setProductEnabled,
  uploadDocument,
  deleteDocument,
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

  const [{ data: users }, { data: products }, { data: enabled }, { data: documents }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("id, role, created_at")
        .eq("business_id", id),
      supabase.from("products").select("id, key, name, status"),
      supabase.from("business_products").select("product_id").eq("business_id", id),
      supabase
        .from("documents")
        .select("id, name, file_size, created_at")
        .eq("business_id", id)
        .order("created_at", { ascending: false }),
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

      <div className="grid-2">
        <div className="panel panel-block">
          <h2 className="panel-title">Users</h2>
          {usersWithEmail.length === 0 ? (
            <p className="empty-state">No users yet.</p>
          ) : (
            <ul className="feed-list">
              {usersWithEmail.map((u) => {
                async function reset(_p: unknown, _f: FormData) {
                  "use server";
                  return resetUserPassword(u.id, u.email);
                }
                return (
                  <li key={u.id}>
                    <span
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        minWidth: 0,
                      }}
                    >
                      <span className="badge badge-blue">{u.role}</span>
                      <span
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          color: "var(--heading)",
                        }}
                      >
                        {u.email}
                      </span>
                    </span>
                    <ActionForm action={reset} className="inline-form">
                      <SubmitButton
                        className="btn btn-secondary btn-sm"
                        pendingText="Sending…"
                      >
                        <KeyRound size={13} /> Reset password
                      </SubmitButton>
                    </ActionForm>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="panel panel-block">
          <h2 className="panel-title">Products</h2>
          <ul className="feed-list">
            {(products ?? []).map((p) => {
              const isEnabled = enabledProductIds.has(p.id);
              async function toggle(_prev: unknown, _f: FormData) {
                "use server";
                return setProductEnabled(id, p.id, !isEnabled);
              }
              return (
                <li key={p.id}>
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      minWidth: 0,
                    }}
                  >
                    <span
                      className={`badge ${isEnabled ? "badge-green" : "badge-gray"}`}
                    >
                      {isEnabled ? "Enabled" : "Disabled"}
                    </span>
                    <span
                      style={{
                        color: "var(--heading)",
                        fontWeight: 600,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {p.name}
                    </span>
                  </span>
                  <ActionForm action={toggle} className="inline-form">
                    <SubmitButton
                      className={`btn btn-sm ${isEnabled ? "btn-danger" : "btn-primary"}`}
                      pendingText="Saving…"
                    >
                      {isEnabled ? "Remove" : "Assign"}
                    </SubmitButton>
                  </ActionForm>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <div className="panel panel-block" style={{ marginBottom: 28 }}>
        <h2 className="panel-title">
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <FileText size={16} /> Documents
          </span>
        </h2>
        <p style={{ margin: "0 0 14px", fontSize: 13, color: "var(--body)" }}>
          Contracts and paperwork uploaded here appear in this customer&apos;s
          portal under Documents, ready to view and download.
        </p>

        <ActionForm action={uploadDocument.bind(null, id)}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <input
              type="file"
              name="file"
              required
              style={{ fontSize: 13, color: "var(--body)", maxWidth: 260 }}
            />
            <input
              type="text"
              name="label"
              placeholder="Display name (optional)"
              style={{
                background: "var(--bg2)",
                border: "1px solid var(--line)",
                borderRadius: "var(--radius-sm)",
                padding: "9px 12px",
                color: "var(--heading)",
                fontSize: 13.5,
              }}
            />
            <SubmitButton className="btn btn-primary btn-sm" pendingText="Uploading…">
              Upload
            </SubmitButton>
          </div>
        </ActionForm>

        {(documents ?? []).length > 0 && (
          <ul className="feed-list" style={{ marginTop: 14 }}>
            {(documents ?? []).map((doc) => {
              async function removeDoc(_p: unknown, _f: FormData) {
                "use server";
                return deleteDocument(doc.id);
              }
              return (
                <li key={doc.id}>
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      minWidth: 0,
                    }}
                  >
                    <FileText size={14} style={{ flex: "none", color: "var(--ac2)" }} />
                    <span
                      style={{
                        color: "var(--heading)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {doc.name}
                    </span>
                    <span style={{ flex: "none", fontSize: 11.5, color: "var(--faint)" }}>
                      {doc.file_size ? `${(doc.file_size / 1024 / 1024).toFixed(1)}MB` : ""}
                    </span>
                  </span>
                  <ActionForm action={removeDoc} className="inline-form">
                    <SubmitButton className="btn btn-danger btn-sm" pendingText="…">
                      Delete
                    </SubmitButton>
                  </ActionForm>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
