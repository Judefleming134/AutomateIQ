import { Plus, Layers, Link2, AlertTriangle } from "lucide-react";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { ActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/admin/submit-button";
import { SystemIcon } from "@/lib/systems/icons";
import { isMissingTableError } from "@/lib/db/errors";
import {
  createSystem,
  setSystemDevStatus,
  deleteSystem,
  assignSystem,
  setAssignmentStatus,
  removeAssignment,
} from "./actions";

const DEV_STATUSES = [
  { v: "planned", l: "Planned" },
  { v: "in_development", l: "In development" },
  { v: "available", l: "Available" },
];
const MODULE_STATUSES = [
  { v: "coming_soon", l: "Coming soon" },
  { v: "provisioning", l: "Provisioning" },
  { v: "active", l: "Active" },
  { v: "disabled", l: "Disabled" },
];

export default async function AdminSystemsPage() {
  await requireAdmin();
  const supabase = createAdminClient();

  const [{ data: systems, error: sysErr }, { data: businesses }, { data: assignments }] =
    await Promise.all([
      supabase
        .from("bsys_systems")
        .select("id, key, name, description, icon, dev_status, is_custom, sort_order")
        .order("sort_order", { ascending: true }),
      supabase
        .from("businesses")
        .select("id, name")
        .is("deleted_at", null)
        .eq("status", "active")
        .order("name"),
      supabase
        .from("bsys_assignments")
        .select("business_id, system_id, module_status, businesses(name), bsys_systems(name, icon)")
        .order("assigned_at", { ascending: false }),
    ]);

  if (sysErr && isMissingTableError(sysErr)) {
    return (
      <>
        <div className="page-header">
          <div>
            <h1>Business Systems</h1>
            <p>One quick database step is needed before you can use this.</p>
          </div>
        </div>
        <div className="panel panel-block">
          <div className="doc-seed-cta">
            <AlertTriangle size={22} />
            <div>
              <strong>Database update required</strong>
              <p>
                Run <code>supabase/manual_update_0012.sql</code> in the Supabase SQL Editor (one
                paste, safe to re-run), then refresh this page.
              </p>
            </div>
          </div>
        </div>
      </>
    );
  }

  const allSystems = systems ?? [];
  const allBiz = businesses ?? [];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Business Systems</h1>
          <p>
            The framework for bespoke enterprise systems. Manage the catalogue, track development,
            and assign systems to organisations — built to scale to hundreds of future modules.
          </p>
        </div>
      </div>

      <div className="stat-row" style={{ marginBottom: 22 }}>
        <div className="stat-chip">
          <span className="stat-chip-value">{allSystems.length}</span>
          <span className="stat-chip-label">Systems</span>
        </div>
        <div className="stat-chip">
          <span className="stat-chip-value">{(assignments ?? []).length}</span>
          <span className="stat-chip-label">Assignments</span>
        </div>
        <div className="stat-chip">
          <span className="stat-chip-value">
            {(assignments ?? []).filter((a) => a.module_status === "active").length}
          </span>
          <span className="stat-chip-label">Active modules</span>
        </div>
      </div>

      {/* Catalogue */}
      <h2 className="section-title">Systems catalogue</h2>
      <details className="disclosure" style={{ marginBottom: 18 }}>
        <summary><Plus size={14} /> New system module</summary>
        <ActionForm action={createSystem} className="panel form-card">
          <div className="field-grid">
            <div className="field">
              <label htmlFor="name">System name</label>
              <input id="name" name="name" type="text" required placeholder="Fleet Maintenance System" />
            </div>
            <div className="field">
              <label htmlFor="icon">Icon</label>
              <input id="icon" name="icon" type="text" defaultValue="layers" placeholder="layers" />
            </div>
          </div>
          <div className="field">
            <label htmlFor="description">Description</label>
            <input id="description" name="description" type="text" placeholder="One line shown on the module card." />
          </div>
          <div className="field-grid">
            <div className="field">
              <label htmlFor="devStatus">Development status</label>
              <select id="devStatus" name="devStatus" defaultValue="planned">
                {DEV_STATUSES.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="sortOrder">Sort order</label>
              <input id="sortOrder" name="sortOrder" type="number" defaultValue={100} />
            </div>
          </div>
          <div className="form-actions">
            <SubmitButton pendingText="Creating…">Create system</SubmitButton>
          </div>
        </ActionForm>
      </details>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr><th>System</th><th>Type</th><th>Development status</th><th></th></tr>
          </thead>
          <tbody>
            {allSystems.map((s) => {
              async function updateDev(formData: FormData) {
                "use server";
                await setSystemDevStatus(s.id, String(formData.get("devStatus")));
              }
              async function remove() {
                "use server";
                await deleteSystem(s.id);
              }
              return (
                <tr key={s.id}>
                  <td>
                    <span className="doc-row-link">
                      <span className="doc-row-icon"><SystemIcon name={s.icon ?? "layers"} size={15} /></span>
                      <span style={{ color: "var(--heading)", fontWeight: 600 }}>{s.name}</span>
                    </span>
                  </td>
                  <td>{s.is_custom ? "Custom" : "Built-in"}</td>
                  <td>
                    <form action={updateDev} style={{ display: "flex", gap: 6 }}>
                      <select name="devStatus" defaultValue={s.dev_status} className="content-schedule-input" style={{ fontSize: 12.5 }}>
                        {DEV_STATUSES.map((d) => <option key={d.v} value={d.v}>{d.l}</option>)}
                      </select>
                      <button type="submit" className="btn btn-secondary btn-sm">Set</button>
                    </form>
                  </td>
                  <td>
                    {s.is_custom && (
                      <form action={remove}>
                        <SubmitButton className="btn btn-danger btn-sm" pendingText="…">Delete</SubmitButton>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Assign to organisations */}
      <h2 className="section-title">Assign to organisations</h2>
      <details className="disclosure" style={{ marginBottom: 18 }}>
        <summary><Link2 size={14} /> Assign a system</summary>
        <ActionForm action={assignSystem} className="panel form-card">
          <div className="field-grid">
            <div className="field">
              <label htmlFor="businessId">Organisation</label>
              <select id="businessId" name="businessId" required>
                <option value="">Select an organisation…</option>
                {allBiz.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="systemId">System</label>
              <select id="systemId" name="systemId" required>
                <option value="">Select a system…</option>
                {allSystems.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>
          <div className="field">
            <label htmlFor="moduleStatus">Module status</label>
            <select id="moduleStatus" name="moduleStatus" defaultValue="coming_soon">
              {MODULE_STATUSES.map((m) => <option key={m.v} value={m.v}>{m.l}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="notes">Notes (internal)</label>
            <input id="notes" name="notes" type="text" placeholder="Optional context for this assignment." />
          </div>
          <div className="form-actions">
            <SubmitButton pendingText="Assigning…">Assign system</SubmitButton>
          </div>
        </ActionForm>
      </details>

      <div className="table-wrap">
        {(assignments ?? []).length === 0 ? (
          <p className="empty-state">No systems assigned to any organisation yet.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr><th>Organisation</th><th>System</th><th>Module status</th><th></th></tr>
            </thead>
            <tbody>
              {(assignments ?? []).map((a) => {
                const biz = a.businesses as unknown as { name: string } | null;
                const sys = a.bsys_systems as unknown as { name: string; icon: string } | null;
                async function updateStatus(formData: FormData) {
                  "use server";
                  await setAssignmentStatus(a.business_id, a.system_id, String(formData.get("moduleStatus")));
                }
                async function unassign() {
                  "use server";
                  await removeAssignment(a.business_id, a.system_id);
                }
                return (
                  <tr key={`${a.business_id}-${a.system_id}`}>
                    <td style={{ color: "var(--heading)", fontWeight: 600 }}>{biz?.name ?? "—"}</td>
                    <td>{sys?.name ?? "—"}</td>
                    <td>
                      <form action={updateStatus} style={{ display: "flex", gap: 6 }}>
                        <select name="moduleStatus" defaultValue={a.module_status} className="content-schedule-input" style={{ fontSize: 12.5 }}>
                          {MODULE_STATUSES.map((m) => <option key={m.v} value={m.v}>{m.l}</option>)}
                        </select>
                        <button type="submit" className="btn btn-secondary btn-sm">Set</button>
                      </form>
                    </td>
                    <td>
                      <form action={unassign}>
                        <SubmitButton className="btn btn-ghost btn-sm" pendingText="…">Remove</SubmitButton>
                      </form>
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
