import Link from "next/link";
import {
  Truck,
  Warehouse,
  PackageCheck,
  Route as RouteIcon,
  Clock,
  Gauge,
  AlertTriangle,
} from "lucide-react";
import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";
import { StatCard } from "@/components/portal/stat-card";
import { LogisticsMap, type MapMarker, type MapRoute } from "@/components/logistics/map";
import { computeKpis } from "@/lib/logistics/core";
import { isMissingTableError } from "@/lib/db/errors";

export default async function LogisticsOverviewPage() {
  await requireSession();
  const supabase = await createClient();

  const { error: probeError } = await supabase
    .from("log_warehouses")
    .select("id", { count: "exact", head: true });

  if (probeError && isMissingTableError(probeError)) {
    return (
      <>
        <div className="page-header">
          <div>
            <h1>AI Logistics Control Centre</h1>
            <p>One quick database step is needed before you can use this.</p>
          </div>
        </div>
        <div className="panel panel-block">
          <div className="doc-seed-cta">
            <AlertTriangle size={22} />
            <div>
              <strong>Database update required</strong>
              <p>
                Run <code>supabase/manual_update_0013.sql</code> in the Supabase SQL Editor (one
                paste, safe to re-run), then refresh this page.
              </p>
            </div>
          </div>
        </div>
      </>
    );
  }

  const [kpis, { data: warehouses }, { data: vehicles }, { data: deliveries }, { data: routes }] =
    await Promise.all([
      computeKpis(supabase),
      supabase.from("log_warehouses").select("id, name, lat, lng, address"),
      supabase.from("log_vehicles").select("id, registration, name, status, last_lat, last_lng"),
      supabase.from("log_deliveries").select("id, customer_name, status, lat, lng, address").limit(200),
      supabase.from("log_routes").select("id, name, status, start_warehouse_id, end_lat, end_lng").eq("status", "active"),
    ]);

  // Build map markers from every located entity.
  const markers: MapMarker[] = [];
  for (const w of warehouses ?? []) {
    if (typeof w.lat === "number") markers.push({ id: `w-${w.id}`, lat: w.lat, lng: w.lng!, kind: "warehouse", label: w.name, sub: w.address || "Warehouse" });
  }
  for (const v of vehicles ?? []) {
    if (typeof v.last_lat === "number") {
      const kind = v.status === "idle" ? "vehicle_idle" : v.status === "maintenance" ? "vehicle_maintenance" : "vehicle";
      markers.push({ id: `v-${v.id}`, lat: v.last_lat, lng: v.last_lng!, kind, label: v.registration, sub: `${v.name ?? "Vehicle"} · ${v.status}` });
    }
  }
  const deliveryKinds = new Set(["delayed", "failed", "delivered"]);
  for (const d of deliveries ?? []) {
    if (typeof d.lat === "number") {
      const kind = deliveryKinds.has(d.status) ? `delivery_${d.status}` : "delivery";
      markers.push({ id: `d-${d.id}`, lat: d.lat, lng: d.lng!, kind, label: d.customer_name, sub: `${d.address || "Delivery"} · ${d.status}` });
    }
  }

  // Active routes as polylines: start warehouse → end point.
  const warehouseCoord = new Map(
    (warehouses ?? []).filter((w) => typeof w.lat === "number").map((w) => [w.id, [w.lat!, w.lng!] as [number, number]])
  );
  const routeLines: MapRoute[] = [];
  for (const r of routes ?? []) {
    const start = r.start_warehouse_id ? warehouseCoord.get(r.start_warehouse_id) : undefined;
    if (start && typeof r.end_lat === "number") {
      routeLines.push({ id: `r-${r.id}`, points: [start, [r.end_lat, r.end_lng!]], color: "#22D3EE" });
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>AI Logistics Control Centre</h1>
          <p>
            Your whole operation on one live map — fleet, warehouses, routes and deliveries. Ask
            your AI Assistant anything, e.g. &ldquo;where is {vehicles?.[0]?.registration ?? "Truck 12"}?&rdquo;
          </p>
        </div>
      </div>

      <div className="stat-grid log-kpi-grid">
        <StatCard label="Active vehicles" value={kpis.vehiclesActive} icon={<Truck />} accent="#34D399" hint={`${kpis.vehiclesTotal} in fleet`} />
        <StatCard label="Fleet utilisation" value={`${kpis.fleetUtilisation}%`} icon={<Gauge />} accent="#3B82F6" hint="active of total" />
        <StatCard label="Warehouses" value={kpis.warehouses} icon={<Warehouse />} accent="#8B5CF6" hint={`${kpis.warehouseCapacityUsed}% capacity used`} />
        <StatCard label="Active routes" value={kpis.activeRoutes} icon={<RouteIcon />} accent="#22D3EE" hint="in progress" />
        <StatCard label="In transit" value={kpis.deliveriesInTransit} icon={<Truck />} accent="#A78BFA" hint="deliveries en route" />
        <StatCard label="On-time rate" value={`${kpis.onTimeRate}%`} icon={<Clock />} accent="#34D399" hint="of closed deliveries" />
        <StatCard label="Delayed" value={kpis.deliveriesDelayed} icon={<AlertTriangle />} accent="#FB923C" hint="need attention" />
        <StatCard label="Delivered" value={kpis.deliveriesDelivered} icon={<PackageCheck />} accent="#34D399" hint="completed" />
      </div>

      <div className="panel panel-block" style={{ marginTop: 8 }}>
        <h2 className="panel-title"><span><span className="sys-index">01 /</span>Live operations map</span></h2>
        <LogisticsMap markers={markers} routes={routeLines} height={520} />
        {markers.length === 0 && (
          <p className="empty-state" style={{ marginTop: 12 }}>
            No located entities yet. Add warehouses, vehicles and deliveries (with an address) and
            they&apos;ll appear here on the map.{" "}
            <Link href="/portal/logistics/warehouses" style={{ color: "var(--ac2)" }}>Add a warehouse →</Link>
          </p>
        )}
      </div>

      <div className="log-quicklinks">
        <Link href="/portal/logistics/fleet" className="panel log-quicklink"><Truck size={18} /> Manage fleet</Link>
        <Link href="/portal/logistics/warehouses" className="panel log-quicklink"><Warehouse size={18} /> Manage warehouses</Link>
        <Link href="/portal/logistics/routes" className="panel log-quicklink"><RouteIcon size={18} /> Plan routes</Link>
        <Link href="/portal/logistics/deliveries" className="panel log-quicklink"><PackageCheck size={18} /> Manage deliveries</Link>
      </div>
    </>
  );
}
