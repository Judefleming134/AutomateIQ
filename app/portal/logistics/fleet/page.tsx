import { Plus, Truck, UserRound, MapPin, Satellite } from "lucide-react";
import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/admin/submit-button";
import { MiniMap } from "@/components/logistics/map";
import {
  createVehicle,
  deleteVehicle,
  setVehicleStatus,
  updateVehicleLocation,
  createDriver,
  deleteDriver,
} from "../actions";

const VSTATUS = ["active", "idle", "maintenance", "inactive"];

export default async function FleetPage() {
  await requireSession();
  const supabase = await createClient();

  const [{ data: vehicles }, { data: drivers }] = await Promise.all([
    supabase
      .from("log_vehicles")
      .select("id, registration, name, vtype, capacity, status, gps_status, gps_provider, last_lat, last_lng, last_seen_at, insurance_expiry, driver_id, log_drivers(name)")
      .order("created_at", { ascending: false }),
    supabase.from("log_drivers").select("id, name, phone, email, status, license_no").order("name"),
  ]);

  const allVehicles = vehicles ?? [];
  const allDrivers = drivers ?? [];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Fleet</h1>
          <p>Trucks, vans, lorries, trailers and drivers. Vehicles with a location appear live on the map; those without GPS support manual updates.</p>
        </div>
      </div>

      {/* Vehicles */}
      <h2 className="section-title">Vehicles</h2>
      <details className="disclosure" style={{ marginBottom: 18 }}>
        <summary><Plus size={14} /> New vehicle</summary>
        <ActionForm action={createVehicle} className="panel form-card">
          <div className="field-grid">
            <div className="field"><label htmlFor="registration">Registration</label><input id="registration" name="registration" required placeholder="12-D-3456" /></div>
            <div className="field"><label htmlFor="name">Name / label</label><input id="name" name="name" placeholder="Truck 12" /></div>
          </div>
          <div className="field-grid">
            <div className="field"><label htmlFor="vtype">Type</label>
              <select id="vtype" name="vtype" defaultValue="van"><option value="truck">Truck</option><option value="van">Van</option><option value="lorry">Lorry</option><option value="trailer">Trailer</option></select>
            </div>
            <div className="field"><label htmlFor="capacity">Capacity</label><input id="capacity" name="capacity" type="number" step="any" placeholder="e.g. 20 (pallets)" /></div>
          </div>
          <div className="field-grid">
            <div className="field"><label htmlFor="driver_id">Assigned driver</label>
              <select id="driver_id" name="driver_id"><option value="">Unassigned</option>{allDrivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
            </div>
            <div className="field"><label htmlFor="insurance_expiry">Insurance expiry</label><input id="insurance_expiry" name="insurance_expiry" type="date" className="content-schedule-input" /></div>
          </div>
          <div className="field"><label htmlFor="gps_provider">GPS provider (optional)</label>
            <select id="gps_provider" name="gps_provider" defaultValue="">
              <option value="">None — manual location</option>
              <option value="samsara">Samsara</option>
              <option value="geotab">Geotab</option>
              <option value="verizon">Verizon Connect</option>
              <option value="teltonika">Teltonika</option>
              <option value="traccar">Traccar</option>
              <option value="custom">Custom GPS provider</option>
            </select>
          </div>
          <div className="field"><label htmlFor="maintenance_notes">Maintenance notes</label><input id="maintenance_notes" name="maintenance_notes" /></div>
          <div className="form-actions"><SubmitButton pendingText="Saving…">Add vehicle</SubmitButton></div>
        </ActionForm>
      </details>

      {allVehicles.length === 0 ? (
        <div className="panel panel-block"><p className="empty-state">No vehicles yet — add your first above.</p></div>
      ) : (
        <div className="log-card-grid">
          {allVehicles.map((v) => {
            const driver = v.log_drivers as unknown as { name: string } | null;
            async function remove() { "use server"; await deleteVehicle(v.id); }
            async function updateStatus(fd: FormData) { "use server"; await setVehicleStatus(v.id, String(fd.get("status"))); }
            return (
              <div key={v.id} className="panel log-entity-card">
                <MiniMap lat={v.last_lat} lng={v.last_lng} label={v.registration} kind={v.status === "idle" ? "vehicle_idle" : v.status === "maintenance" ? "vehicle_maintenance" : "vehicle"} height={150} />
                <div className="log-entity-body">
                  <div className="log-entity-head">
                    <span className="log-entity-icon" style={{ color: "#34D399" }}><Truck size={16} /></span>
                    <div>
                      <strong>{v.name || v.registration}</strong>
                      <span className="log-entity-sub">{v.registration} · {v.vtype}</span>
                    </div>
                    <span className={`badge ${v.gps_status === "live" ? "badge-green" : "badge-gray"}`} style={{ marginLeft: "auto" }}>
                      <Satellite size={10} /> {v.gps_status}
                    </span>
                  </div>
                  <dl className="log-mini-meta">
                    <div><dt>Driver</dt><dd>{driver?.name ?? "Unassigned"}</dd></div>
                    {v.gps_provider && <div><dt>GPS</dt><dd>{v.gps_provider}</dd></div>}
                    {v.insurance_expiry && <div><dt>Insurance</dt><dd>{new Date(v.insurance_expiry).toLocaleDateString("en-IE")}</dd></div>}
                    {v.last_seen_at && <div><dt>Last seen</dt><dd>{new Date(v.last_seen_at).toLocaleString("en-IE")}</dd></div>}
                  </dl>
                  <form action={updateStatus} style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                    <select name="status" defaultValue={v.status} className="content-schedule-input" style={{ flex: 1 }}>
                      {VSTATUS.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <button type="submit" className="btn btn-secondary btn-sm">Set</button>
                  </form>
                  <details className="disclosure">
                    <summary><MapPin size={12} /> Update location</summary>
                    <ActionForm action={updateVehicleLocation} className="panel form-card" style={{ maxWidth: "none", marginTop: 8, padding: 14 }}>
                      <input type="hidden" name="id" value={v.id} />
                      <div className="field"><label>Address</label><input name="address" placeholder="Town, city or address" /></div>
                      <div className="field-grid">
                        <div className="field"><label>Latitude</label><input name="lat" type="number" step="any" /></div>
                        <div className="field"><label>Longitude</label><input name="lng" type="number" step="any" /></div>
                      </div>
                      <div className="form-actions"><SubmitButton className="btn btn-primary btn-sm" pendingText="…">Update</SubmitButton></div>
                    </ActionForm>
                  </details>
                  <form action={remove} style={{ marginTop: 10 }}>
                    <SubmitButton className="btn btn-ghost btn-sm" pendingText="…">Delete vehicle</SubmitButton>
                  </form>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Drivers */}
      <h2 className="section-title" style={{ marginTop: 30 }}>Drivers</h2>
      <details className="disclosure" style={{ marginBottom: 18 }}>
        <summary><Plus size={14} /> New driver</summary>
        <ActionForm action={createDriver} className="panel form-card">
          <div className="field-grid">
            <div className="field"><label htmlFor="dname">Name</label><input id="dname" name="name" required /></div>
            <div className="field"><label htmlFor="license_no">Licence no.</label><input id="license_no" name="license_no" /></div>
          </div>
          <div className="field-grid">
            <div className="field"><label htmlFor="phone">Phone</label><input id="phone" name="phone" /></div>
            <div className="field"><label htmlFor="email">Email</label><input id="email" name="email" type="email" /></div>
          </div>
          <div className="field"><label htmlFor="dnotes">Notes</label><input id="dnotes" name="notes" /></div>
          <div className="form-actions"><SubmitButton pendingText="Saving…">Add driver</SubmitButton></div>
        </ActionForm>
      </details>

      <div className="table-wrap">
        {allDrivers.length === 0 ? (
          <p className="empty-state">No drivers yet.</p>
        ) : (
          <table className="data-table">
            <thead><tr><th>Driver</th><th>Contact</th><th>Licence</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {allDrivers.map((d) => {
                async function remove() { "use server"; await deleteDriver(d.id); }
                return (
                  <tr key={d.id}>
                    <td><span className="doc-row-link"><span className="doc-row-icon"><UserRound size={14} /></span><span style={{ color: "var(--heading)", fontWeight: 600 }}>{d.name}</span></span></td>
                    <td>{[d.phone, d.email].filter(Boolean).join(" · ") || "—"}</td>
                    <td>{d.license_no || "—"}</td>
                    <td><span className={`badge ${d.status === "active" ? "badge-green" : "badge-gray"}`}>{d.status}</span></td>
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
