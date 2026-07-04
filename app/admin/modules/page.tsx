import { Plus } from "lucide-react";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { createModule, deleteModule } from "./actions";
import { ActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/admin/submit-button";

export default async function AdminModulesPage() {
  await requireAdmin();
  const supabase = createAdminClient();

  const [{ data: modules }, { data: businesses }] = await Promise.all([
    supabase
      .from("custom_modules")
      .select("id, name, description, route_slug, created_at, businesses(name)")
      .order("created_at", { ascending: false }),
    supabase
      .from("businesses")
      .select("id, name")
      .is("deleted_at", null)
      .eq("status", "active")
      .order("name"),
  ]);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Custom modules</h1>
          <p>
            Build a bespoke module for a customer — it appears in their portal
            under Custom Solutions the moment you create it.
          </p>
        </div>
      </div>

      <details className="disclosure">
        <summary>
          <Plus size={14} /> New module
        </summary>
        <ActionForm action={createModule} className="panel form-card">
          <div className="field">
            <label htmlFor="businessId">Customer</label>
            <select id="businessId" name="businessId" required>
              <option value="">Select a business…</option>
              {(businesses ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="name">Module name</label>
            <input id="name" type="text" name="name" required placeholder="Quote Generator" />
          </div>
          <div className="field">
            <label htmlFor="description">Short description</label>
            <input id="description" type="text" name="description" placeholder="Shown on the module's tile" />
          </div>
          <div className="field">
            <label htmlFor="content">Content / instructions</label>
            <textarea
              id="content"
              name="content"
              rows={4}
              placeholder="Text shown on the module's page — how to use it, what it does, links, anything."
            />
          </div>
          <div className="field">
            <label htmlFor="embedUrl">Embed URL (optional)</label>
            <input
              id="embedUrl"
              type="url"
              name="embedUrl"
              placeholder="https://… — an external tool to embed inside the module page"
            />
          </div>
          <div className="form-actions">
            <SubmitButton pendingText="Creating…">Create module</SubmitButton>
          </div>
        </ActionForm>
      </details>

      <div className="table-wrap">
        {(modules ?? []).length === 0 ? (
          <p className="empty-state">No custom modules yet.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Module</th>
                <th>Customer</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(modules ?? []).map((m) => {
                const business = m.businesses as unknown as { name: string } | null;
                async function remove(_p: unknown, _f: FormData) {
                  "use server";
                  return deleteModule(m.id);
                }
                return (
                  <tr key={m.id}>
                    <td>
                      <span style={{ color: "var(--heading)", fontWeight: 600 }}>{m.name}</span>
                      {m.description && (
                        <span style={{ color: "var(--faint)" }}> — {m.description}</span>
                      )}
                    </td>
                    <td>{business?.name ?? "—"}</td>
                    <td>{new Date(m.created_at).toLocaleDateString()}</td>
                    <td>
                      <ActionForm action={remove} className="inline-form">
                        <SubmitButton className="btn btn-danger btn-sm" pendingText="Deleting…">
                          Delete
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
    </>
  );
}
