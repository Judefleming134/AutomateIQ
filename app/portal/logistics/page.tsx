import Link from "next/link";
import {
  Truck,
  Warehouse,
  PackageCheck,
  Route as RouteIcon,
  Clock,
  Gauge,
  AlertTriangle,
  Radio,
  Satellite,
  KeyRound,
  Rocket,
} from "lucide-react";
import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";
import { StatCard } from "@/components/portal/stat-card";
import { LiveFleetMap } from "@/components/logistics/live-fleet-map";
import { type MapMarker, type MapRoute } from "@/components/logistics/map";
import { ActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/admin/submit-button";
import { computeKpis } from "@/lib/logistics/core";
import { isMissingTableError } from "@/lib/db/errors";
import { toggleLiveSim, regenerateIngestToken, loadDemoFleet } from "./actions";

export default async function LogisticsOverviewPage() {
  const { profile } = await requireSession();
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

  const [kpis, { data: warehouses }, { data: vehicles }, { data: deliveries }, { data: routes }, { data: settings }] =
    await Promise.all([
      computeKpis(supabase),
      supabase.from("log_warehouses").select("id, name, lat, lng, address"),
      supabase.from("log_vehicles").select("id, registration, name, status, last_lat, last_lng, gps_status"),
      supabase.from("log_deliveries").select("id, customer_name, status, lat, lng, address").limit(200),
      supabase.from("log_routes").select("id, name, status, start_warehouse_id, end_lat, end_lng").eq("status", "active"),
      supabase.from("log_settings").select("live_sim, ingest_token").eq("business_id", profile.business_id!).maybeSingle(),
    ]);

  // Static markers (warehouses + deliveries); vehicles are drawn live.
  const staticMarkers: MapMarker[] = [];
  for (const w of warehouses ?? []) {
    if (typeof w.lat === "number") staticMarkers.push({ id: `w-${w.id}`, lat: w.lat, lng: w.lng!, kind: "warehouse", label: w.name, sub: w.address || "Warehouse" });
  }
  const deliveryKinds = new Set(["delayed", "failed", "delivered"]);
  for (const d of deliveries ?? []) {
    if (typeof d.lat === "number") {
      const kind = deliveryKinds.has(d.status) ? `delivery_${d.status}` : "delivery";
      staticMarkers.push({ id: `d-${d.id}`, lat: d.lat, lng: d.lng!, kind, label: d.customer_name, sub: `${d.address || "Delivery"} · ${d.status}` });
    }
  }

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

  const liveOn = Boolean(settings?.live_sim);
  const hasData = (warehouses ?? []).length > 0 || (vehicles ?? []).length > 0;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://automateiq.ie";

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
        <span className={`badge ${liveOn ? "badge-green" : "badge-gray"}`} style={{ alignSelf: "center" }}>
          <Radio size={11} /> {liveOn ? "Live tracking on" : "Live tracking off"}
        </span>
      </div>

      {!hasData && (
        <div className="panel panel-block" style={{ marginBottom: 8 }}>
          <div className="doc-seed-cta">
            <Rocket size={22} />
            <div>
              <strong>See it working in one click</strong>
              <p>Load a demo fleet — two depots, vehicles, an active Dublin→Cork route and deliveries across Ireland — with live tracking on, so the map moves by itself right away.</p>
            </div>
            <ActionForm action={loadDemoFleet} className="inline-form">
              <SubmitButton pendingText="Loading…">Load demo fleet</SubmitButton>
            </ActionForm>
          </div>
        </div>
      )}

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
        <LiveFleetMap
          staticMarkers={staticMarkers}
          initialVehicles={vehicles ?? []}
          routes={routeLines}
          height={520}
        />
        {staticMarkers.length === 0 && (vehicles ?? []).length === 0 && (
          <p className="empty-state" style={{ marginTop: 12 }}>
            No located entities yet — load the demo fleet above, or add warehouses, vehicles and
            deliveries (with an address).{" "}
            <Link href="/portal/logistics/warehouses" style={{ color: "var(--ac2)" }}>Add a warehouse →</Link>
          </p>
        )}
      </div>

      {/* Live tracking + GPS ingest */}
      <div className="grid-main-side" style={{ marginTop: 18 }}>
        <div className="panel panel-block">
          <h2 className="panel-title"><span><span className="sys-index">02 /</span>Live tracking</span></h2>
          <p style={{ fontSize: 13.5, color: "var(--body)", margin: "0 0 14px", lineHeight: 1.55 }}>
            {liveOn
              ? "Live tracking is on — the platform is moving your simulated vehicles along their routes right now. Real GPS-fed vehicles update independently."
              : "Turn on live tracking and the platform self-drives your simulated vehicles around their routes — no GPS hardware needed. Connect a real provider below whenever you're ready."}
          </p>
          <ActionForm action={toggleLiveSim} className="inline-form">
            <SubmitButton className={liveOn ? "btn btn-secondary" : "btn btn-primary"} pendingText="…">
              <Satellite size={14} /> {liveOn ? "Turn off live tracking" : "Turn on live tracking"}
            </SubmitButton>
          </ActionForm>
        </div>

        <div className="panel panel-block">
          <h2 className="panel-title"><span><span className="sys-index">03 /</span>Connect a GPS provider</span></h2>
          <p style={{ fontSize: 13, color: "var(--body)", margin: "0 0 12px", lineHeight: 1.5 }}>
            Plug in Samsara, Geotab, Verizon, Teltonika, Traccar or a custom feed later. Point the
            provider at this endpoint with your ingest token — positions update the matching vehicle
            by registration.
          </p>
          <div className="log-ingest">
            <span className="log-ingest-label">Endpoint</span>
            <code>POST {siteUrl}/api/logistics/gps</code>
            {settings?.ingest_token ? (
              <>
                <span className="log-ingest-label" style={{ marginTop: 10 }}>Your ingest token</span>
                <code className="log-ingest-token">{settings.ingest_token}</code>
                <p className="log-ingest-note">Send as <code>Authorization: Bearer &lt;token&gt;</code>. Body: <code>{`{ "registration": "12-D-3456", "lat": 53.34, "lng": -6.26 }`}</code></p>
                <ActionForm action={regenerateIngestToken} className="inline-form" style={{ marginTop: 8 }}>
                  <SubmitButton className="btn btn-ghost btn-sm" pendingText="…"><KeyRound size={12} /> Rotate token</SubmitButton>
                </ActionForm>
              </>
            ) : (
              <p className="log-ingest-note" style={{ marginTop: 10 }}>
                Run <code>supabase/manual_update_0014.sql</code> to enable live tracking + GPS ingest.
              </p>
            )}
          </div>
        </div>
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
