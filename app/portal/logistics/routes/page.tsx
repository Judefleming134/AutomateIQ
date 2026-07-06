import { Plus, Route as RouteIcon, MapPin } from "lucide-react";
import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/admin/submit-button";
import { LogisticsMap, type MapMarker, type MapRoute } from "@/components/logistics/map";
import { haversineKm } from "@/lib/logistics/core";
import { createRoute, deleteRoute, setRouteStatus, addRouteStop } from "../actions";

const RSTATUS = ["draft", "active", "completed", "archived"];

export default async function RoutesPage() {
  await requireSession();
  const supabase = await createClient();

  const [{ data: routes }, { data: warehouses }, { data: drivers }, { data: vehicles }, { data: stops }] =
    await Promise.all([
      supabase
        .from("log_routes")
        .select("id, name, status, end_address, end_lat, end_lng, start_warehouse_id, notes, log_warehouses(name, lat, lng), log_drivers(name), log_vehicles(registration)")
        .order("created_at", { ascending: false }),
      supabase.from("log_warehouses").select("id, name").order("name"),
      supabase.from("log_drivers").select("id, name").order("name"),
      supabase.from("log_vehicles").select("id, registration, name").order("registration"),
      supabase.from("log_route_stops").select("id, route_id, seq, label, address, lat, lng").order("seq"),
    ]);

  const allRoutes = routes ?? [];
  const stopsByRoute = new Map<string, typeof stops>();
  for (const s of stops ?? []) {
    if (!stopsByRoute.has(s.route_id)) stopsByRoute.set(s.route_id, []);
    stopsByRoute.get(s.route_id)!.push(s);
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Routes</h1>
          <p>Plan routes from a warehouse through drop-off stops to a destination. Distance and the map path are calculated automatically.</p>
        </div>
      </div>

      <details className="disclosure" style={{ marginBottom: 18 }}>
        <summary><Plus size={14} /> New route</summary>
        <ActionForm action={createRoute} className="panel form-card">
          <div className="field"><label htmlFor="name">Route name</label><input id="name" name="name" required placeholder="Monday · North Dublin" /></div>
          <div className="field-grid">
            <div className="field"><label htmlFor="start_warehouse_id">Start warehouse</label>
              <select id="start_warehouse_id" name="start_warehouse_id"><option value="">None</option>{(warehouses ?? []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
            </div>
            <div className="field"><label htmlFor="end_address">End destination</label><input id="end_address" name="end_address" placeholder="Final address — geocoded" /></div>
          </div>
          <div className="field-grid">
            <div className="field"><label htmlFor="driver_id">Driver</label>
              <select id="driver_id" name="driver_id"><option value="">Unassigned</option>{(drivers ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
            </div>
            <div className="field"><label htmlFor="vehicle_id">Vehicle</label>
              <select id="vehicle_id" name="vehicle_id"><option value="">Unassigned</option>{(vehicles ?? []).map((v) => <option key={v.id} value={v.id}>{v.name || v.registration}</option>)}</select>
            </div>
          </div>
          <div className="field"><label htmlFor="notes">Notes</label><input id="notes" name="notes" /></div>
          <div className="form-actions"><SubmitButton pendingText="Saving…">Create route</SubmitButton></div>
        </ActionForm>
      </details>

      {allRoutes.length === 0 ? (
        <div className="panel panel-block"><p className="empty-state">No routes yet — plan your first above.</p></div>
      ) : (
        <div className="log-route-list">
          {allRoutes.map((r) => {
            const wh = r.log_warehouses as unknown as { name: string; lat: number | null; lng: number | null } | null;
            const driver = r.log_drivers as unknown as { name: string } | null;
            const vehicle = r.log_vehicles as unknown as { registration: string } | null;
            const routeStops = stopsByRoute.get(r.id) ?? [];

            // Build the map path: warehouse → stops → end.
            const points: [number, number][] = [];
            if (wh && typeof wh.lat === "number") points.push([wh.lat, wh.lng!]);
            for (const s of routeStops) if (typeof s.lat === "number") points.push([s.lat, s.lng!]);
            if (typeof r.end_lat === "number") points.push([r.end_lat, r.end_lng!]);

            let distance = 0;
            for (let i = 1; i < points.length; i++) distance += haversineKm(points[i - 1], points[i]);

            const markers: MapMarker[] = [];
            if (wh && typeof wh.lat === "number") markers.push({ id: `w-${r.id}`, lat: wh.lat, lng: wh.lng!, kind: "warehouse", label: wh.name });
            routeStops.forEach((s, i) => { if (typeof s.lat === "number") markers.push({ id: `s-${s.id}`, lat: s.lat, lng: s.lng!, kind: "stop", label: `${i + 1}. ${s.label}` }); });
            if (typeof r.end_lat === "number") markers.push({ id: `e-${r.id}`, lat: r.end_lat, lng: r.end_lng!, kind: "delivery", label: r.end_address || "Destination" });
            const line: MapRoute[] = points.length >= 2 ? [{ id: r.id, points, color: "#22D3EE" }] : [];

            async function remove() { "use server"; await deleteRoute(r.id); }
            async function updateStatus(fd: FormData) { "use server"; await setRouteStatus(r.id, String(fd.get("status"))); }

            return (
              <div key={r.id} className="panel log-route-card">
                <div className="log-route-map">
                  <LogisticsMap mini markers={markers} routes={line} height={200} showSearch={false} showLayerToggle={false} />
                </div>
                <div className="log-route-body">
                  <div className="log-entity-head">
                    <span className="log-entity-icon" style={{ color: "#22D3EE" }}><RouteIcon size={16} /></span>
                    <div>
                      <strong>{r.name}</strong>
                      <span className="log-entity-sub">
                        {wh?.name ?? "—"} → {r.end_address || "—"} · {distance > 0 ? `${Math.round(distance)} km` : "distance n/a"}
                      </span>
                    </div>
                    <span className={`badge ${r.status === "active" ? "badge-green" : "badge-gray"}`} style={{ marginLeft: "auto" }}>{r.status}</span>
                  </div>
                  <dl className="log-mini-meta">
                    <div><dt>Driver</dt><dd>{driver?.name ?? "Unassigned"}</dd></div>
                    <div><dt>Vehicle</dt><dd>{vehicle?.registration ?? "Unassigned"}</dd></div>
                    <div><dt>Stops</dt><dd>{routeStops.length}</dd></div>
                  </dl>

                  {routeStops.length > 0 && (
                    <ol className="log-stop-list">
                      {routeStops.map((s) => <li key={s.id}><MapPin size={11} /> {s.label}{s.address && s.address !== s.label ? ` — ${s.address}` : ""}</li>)}
                    </ol>
                  )}

                  <details className="disclosure">
                    <summary><Plus size={12} /> Add drop-off stop</summary>
                    <ActionForm action={addRouteStop} className="panel form-card" style={{ maxWidth: "none", marginTop: 8, padding: 14 }}>
                      <input type="hidden" name="route_id" value={r.id} />
                      <div className="field-grid">
                        <div className="field"><label>Label</label><input name="label" placeholder="Customer / stop name" /></div>
                        <div className="field"><label>Address</label><input name="address" required placeholder="Address — geocoded" /></div>
                      </div>
                      <div className="form-actions"><SubmitButton className="btn btn-primary btn-sm" pendingText="…">Add stop</SubmitButton></div>
                    </ActionForm>
                  </details>

                  <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
                    <form action={updateStatus} style={{ display: "flex", gap: 6 }}>
                      <select name="status" defaultValue={r.status} className="content-schedule-input">{RSTATUS.map((s) => <option key={s} value={s}>{s}</option>)}</select>
                      <button type="submit" className="btn btn-secondary btn-sm">Set</button>
                    </form>
                    <form action={remove}><SubmitButton className="btn btn-ghost btn-sm" pendingText="…">Delete</SubmitButton></form>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
