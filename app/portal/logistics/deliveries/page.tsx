import { Plus, PackageCheck } from "lucide-react";
import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/admin/submit-button";
import { createDelivery, deleteDelivery, setDeliveryStatus } from "../actions";

const DSTATUS = ["scheduled", "in_transit", "delivered", "delayed", "failed"];
const STATUS_BADGE: Record<string, string> = {
  scheduled: "badge-gray",
  in_transit: "badge-blue",
  delivered: "badge-green",
  delayed: "badge-orange",
  failed: "badge-red",
};

export default async function DeliveriesPage() {
  await requireSession();
  const supabase = await createClient();

  const [{ data: deliveries }, { data: drivers }, { data: vehicles }, { data: routes }] =
    await Promise.all([
      supabase
        .from("log_deliveries")
        .select("id, customer_name, address, status, window_start, window_end, notes, log_drivers(name), log_vehicles(registration)")
        .order("created_at", { ascending: false })
        .limit(300),
      supabase.from("log_drivers").select("id, name").order("name"),
      supabase.from("log_vehicles").select("id, registration, name").order("registration"),
      supabase.from("log_routes").select("id, name").order("created_at", { ascending: false }),
    ]);

  const all = deliveries ?? [];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Deliveries</h1>
          <p>Every delivery, geocoded to the map, with live status from scheduled through to delivered.</p>
        </div>
      </div>

      <details className="disclosure" style={{ marginBottom: 18 }}>
        <summary><Plus size={14} /> New delivery</summary>
        <ActionForm action={createDelivery} className="panel form-card">
          <div className="field-grid">
            <div className="field"><label htmlFor="customer_name">Customer</label><input id="customer_name" name="customer_name" required /></div>
            <div className="field"><label htmlFor="address">Delivery address</label><input id="address" name="address" placeholder="Address — geocoded to the map" /></div>
          </div>
          <div className="field-grid">
            <div className="field"><label htmlFor="window_start">Window start</label><input id="window_start" name="window_start" type="datetime-local" className="content-schedule-input" /></div>
            <div className="field"><label htmlFor="window_end">Window end</label><input id="window_end" name="window_end" type="datetime-local" className="content-schedule-input" /></div>
          </div>
          <div className="field-grid">
            <div className="field"><label htmlFor="driver_id">Driver</label>
              <select id="driver_id" name="driver_id"><option value="">Unassigned</option>{(drivers ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
            </div>
            <div className="field"><label htmlFor="vehicle_id">Vehicle</label>
              <select id="vehicle_id" name="vehicle_id"><option value="">Unassigned</option>{(vehicles ?? []).map((v) => <option key={v.id} value={v.id}>{v.name || v.registration}</option>)}</select>
            </div>
          </div>
          <div className="field"><label htmlFor="route_id">Route</label>
            <select id="route_id" name="route_id"><option value="">None</option>{(routes ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
          </div>
          <div className="field"><label htmlFor="notes">Notes</label><input id="notes" name="notes" /></div>
          <div className="form-actions"><SubmitButton pendingText="Saving…">Create delivery</SubmitButton></div>
        </ActionForm>
      </details>

      <div className="table-wrap">
        {all.length === 0 ? (
          <p className="empty-state">No deliveries yet — add your first above.</p>
        ) : (
          <table className="data-table">
            <thead><tr><th>Customer</th><th>Address</th><th>Window</th><th>Driver</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {all.map((d) => {
                const driver = d.log_drivers as unknown as { name: string } | null;
                async function updateStatus(fd: FormData) { "use server"; await setDeliveryStatus(d.id, String(fd.get("status"))); }
                async function remove() { "use server"; await deleteDelivery(d.id); }
                return (
                  <tr key={d.id}>
                    <td style={{ color: "var(--heading)", fontWeight: 600 }}><PackageCheck size={13} style={{ verticalAlign: "-2px", marginRight: 6, color: "#A78BFA" }} />{d.customer_name}</td>
                    <td style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.address || "—"}</td>
                    <td>{d.window_start ? new Date(d.window_start).toLocaleString("en-IE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                    <td>{driver?.name ?? "—"}</td>
                    <td>
                      <form action={updateStatus} style={{ display: "flex", gap: 6 }}>
                        <select name="status" defaultValue={d.status} className={`content-schedule-input`} style={{ fontSize: 12 }}>
                          {DSTATUS.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
                        </select>
                        <button type="submit" className="btn btn-secondary btn-sm">Set</button>
                      </form>
                    </td>
                    <td><form action={remove}><SubmitButton className="btn btn-ghost btn-sm" pendingText="…">Delete</SubmitButton></form></td>
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
