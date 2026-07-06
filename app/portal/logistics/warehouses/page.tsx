import { Plus, Warehouse as WarehouseIcon } from "lucide-react";
import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/admin/submit-button";
import { MiniMap } from "@/components/logistics/map";
import { createWarehouse, deleteWarehouse } from "../actions";

export default async function WarehousesPage() {
  await requireSession();
  const supabase = await createClient();
  const { data: warehouses } = await supabase
    .from("log_warehouses")
    .select("id, name, address, lat, lng, wh_type, capacity, current_utilisation, contact_name, contact_phone, opening_hours, status")
    .order("created_at", { ascending: false });

  const all = warehouses ?? [];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Warehouses</h1>
          <p>Create unlimited warehouses. Each is geocoded and plotted on the live map automatically.</p>
        </div>
      </div>

      <details className="disclosure" style={{ marginBottom: 18 }}>
        <summary><Plus size={14} /> New warehouse</summary>
        <ActionForm action={createWarehouse} className="panel form-card">
          <div className="field-grid">
            <div className="field"><label htmlFor="name">Name</label><input id="name" name="name" required placeholder="Central Distribution" /></div>
            <div className="field"><label htmlFor="wh_type">Type</label><input id="wh_type" name="wh_type" defaultValue="distribution" placeholder="distribution / cold store / depot" /></div>
          </div>
          <div className="field"><label htmlFor="address">Address</label><input id="address" name="address" placeholder="Full address — geocoded to the map" /></div>
          <div className="field-grid">
            <div className="field"><label htmlFor="capacity">Capacity</label><input id="capacity" name="capacity" type="number" step="any" placeholder="e.g. 1000" /></div>
            <div className="field"><label htmlFor="current_utilisation">Current utilisation</label><input id="current_utilisation" name="current_utilisation" type="number" step="any" placeholder="e.g. 640" /></div>
          </div>
          <div className="field-grid">
            <div className="field"><label htmlFor="contact_name">Contact name</label><input id="contact_name" name="contact_name" /></div>
            <div className="field"><label htmlFor="contact_phone">Contact phone</label><input id="contact_phone" name="contact_phone" /></div>
          </div>
          <div className="field"><label htmlFor="opening_hours">Opening hours</label><input id="opening_hours" name="opening_hours" placeholder="Mon–Fri 8am–6pm" /></div>
          <div className="field"><label htmlFor="notes">Notes</label><input id="notes" name="notes" /></div>
          <div className="form-actions"><SubmitButton pendingText="Saving…">Create warehouse</SubmitButton></div>
        </ActionForm>
      </details>

      {all.length === 0 ? (
        <div className="panel panel-block"><p className="empty-state">No warehouses yet — add your first above.</p></div>
      ) : (
        <div className="log-card-grid">
          {all.map((w) => {
            const cap = Number(w.capacity) || 0;
            const used = Number(w.current_utilisation) || 0;
            const pct = cap > 0 ? Math.round((used / cap) * 100) : 0;
            async function remove() { "use server"; await deleteWarehouse(w.id); }
            return (
              <div key={w.id} className="panel log-entity-card">
                <MiniMap lat={w.lat} lng={w.lng} label={w.name} kind="warehouse" height={150} />
                <div className="log-entity-body">
                  <div className="log-entity-head">
                    <span className="log-entity-icon" style={{ color: "#3B82F6" }}><WarehouseIcon size={16} /></span>
                    <div>
                      <strong>{w.name}</strong>
                      <span className="log-entity-sub">{w.address || "No address"}</span>
                    </div>
                  </div>
                  <dl className="log-mini-meta">
                    <div><dt>Type</dt><dd>{w.wh_type}</dd></div>
                    <div><dt>Capacity</dt><dd>{cap > 0 ? `${used}/${cap} (${pct}%)` : "—"}</dd></div>
                    {w.contact_name && <div><dt>Contact</dt><dd>{w.contact_name}{w.contact_phone ? ` · ${w.contact_phone}` : ""}</dd></div>}
                    {w.opening_hours && <div><dt>Hours</dt><dd>{w.opening_hours}</dd></div>}
                  </dl>
                  {cap > 0 && (
                    <div className="log-capbar"><span style={{ width: `${Math.min(pct, 100)}%`, background: pct > 90 ? "var(--red)" : pct > 70 ? "var(--orange)" : "var(--green)" }} /></div>
                  )}
                  <form action={remove} style={{ marginTop: 12 }}>
                    <SubmitButton className="btn btn-ghost btn-sm" pendingText="…">Delete</SubmitButton>
                  </form>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
