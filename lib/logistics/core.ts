import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Logistics computations shared by the Control Centre pages and the AI
 * Assistant's logistics tools — so a KPI the assistant quotes and one the
 * dashboard shows are always the same number. Everything is derived from the
 * business's own RLS-scoped data.
 */

export type LogisticsKpis = {
  vehiclesActive: number;
  vehiclesIdle: number;
  vehiclesMaintenance: number;
  vehiclesTotal: number;
  fleetUtilisation: number; // % active of total
  warehouses: number;
  warehouseCapacityUsed: number; // %
  drivers: number;
  deliveriesTotal: number;
  deliveriesDelivered: number;
  deliveriesInTransit: number;
  deliveriesDelayed: number;
  deliveriesFailed: number;
  deliveriesScheduled: number;
  onTimeRate: number; // delivered / (delivered + delayed + failed)
  successRate: number; // delivered / (all closed)
  activeRoutes: number;
};

/** Round to a whole percentage, guarding divide-by-zero. */
function pct(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 100);
}

export async function computeKpis(
  supabase: SupabaseClient
): Promise<LogisticsKpis> {
  const [{ data: vehicles }, { data: warehouses }, { data: deliveries }, { count: drivers }, { count: activeRoutes }] =
    await Promise.all([
      supabase.from("log_vehicles").select("status"),
      supabase.from("log_warehouses").select("capacity, current_utilisation"),
      supabase.from("log_deliveries").select("status"),
      supabase.from("log_drivers").select("id", { count: "exact", head: true }),
      supabase.from("log_routes").select("id", { count: "exact", head: true }).eq("status", "active"),
    ]);

  const v = vehicles ?? [];
  const vehiclesActive = v.filter((x) => x.status === "active").length;
  const vehiclesIdle = v.filter((x) => x.status === "idle").length;
  const vehiclesMaintenance = v.filter((x) => x.status === "maintenance").length;

  const wh = warehouses ?? [];
  const totalCap = wh.reduce((s, x) => s + (Number(x.capacity) || 0), 0);
  const usedCap = wh.reduce((s, x) => s + (Number(x.current_utilisation) || 0), 0);

  const d = deliveries ?? [];
  const delivered = d.filter((x) => x.status === "delivered").length;
  const inTransit = d.filter((x) => x.status === "in_transit").length;
  const delayed = d.filter((x) => x.status === "delayed").length;
  const failed = d.filter((x) => x.status === "failed").length;
  const scheduled = d.filter((x) => x.status === "scheduled").length;
  const closed = delivered + delayed + failed;

  return {
    vehiclesActive,
    vehiclesIdle,
    vehiclesMaintenance,
    vehiclesTotal: v.length,
    fleetUtilisation: pct(vehiclesActive, v.length),
    warehouses: wh.length,
    warehouseCapacityUsed: pct(usedCap, totalCap),
    drivers: drivers ?? 0,
    deliveriesTotal: d.length,
    deliveriesDelivered: delivered,
    deliveriesInTransit: inTransit,
    deliveriesDelayed: delayed,
    deliveriesFailed: failed,
    deliveriesScheduled: scheduled,
    onTimeRate: pct(delivered, closed),
    successRate: pct(delivered, closed),
    activeRoutes: activeRoutes ?? 0,
  };
}

/** Great-circle distance in km between two coordinates (Haversine). */
export function haversineKm(
  a: [number, number],
  b: [number, number]
): number {
  const R = 6371;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const lat1 = (a[0] * Math.PI) / 180;
  const lat2 = (b[0] * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)) * 10) / 10;
}

/**
 * Server-side geocode via OpenStreetMap Nominatim — turns a typed address into
 * real coordinates so every entity lands correctly on the map. Best-effort:
 * returns null on any failure so a save is never blocked by geocoding.
 */
export async function geocodeAddress(
  address: string
): Promise<{ lat: number; lng: number } | null> {
  const q = address.trim();
  if (!q) return null;
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`,
      { headers: { "User-Agent": "AutomateIQ-Logistics/1.0", Accept: "application/json" } }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { lat: string; lon: string }[];
    const hit = data?.[0];
    if (!hit) return null;
    return { lat: parseFloat(hit.lat), lng: parseFloat(hit.lon) };
  } catch {
    return null;
  }
}
