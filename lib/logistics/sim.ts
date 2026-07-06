import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { haversineKm } from "@/lib/logistics/core";

/**
 * Self-running fleet simulation. When a business turns on live tracking, this
 * advances every "simulated" vehicle (one with no real GPS provider) a short
 * step toward a sensible target on each tick — so the map is genuinely live
 * without any external feed. Real-provider vehicles are never touched here;
 * their positions arrive through /api/logistics/gps instead.
 *
 * Called from POST /api/logistics/positions under the caller's RLS-scoped
 * client, so it only ever moves the caller's own vehicles.
 */

type Coord = [number, number];

// ~250m step per tick, with a little jitter so movement looks natural.
const STEP_DEG = 0.0025;
const ARRIVE_KM = 0.4;

function stepToward(from: Coord, to: Coord): Coord {
  const dLat = to[0] - from[0];
  const dLng = to[1] - from[1];
  const dist = Math.hypot(dLat, dLng);
  if (dist < 1e-6) return from;
  const scale = Math.min(STEP_DEG, dist) / dist;
  const jitter = () => (Math.random() - 0.5) * STEP_DEG * 0.3;
  return [from[0] + dLat * scale + jitter(), from[1] + dLng * scale + jitter()];
}

export type LivePosition = {
  id: string;
  registration: string;
  name: string | null;
  status: string;
  lat: number | null;
  lng: number | null;
  gps_status: string;
};

/**
 * Advance simulated vehicles one tick and persist. Returns nothing; callers
 * re-read positions afterwards. Safe to call frequently.
 */
export async function runSimulationTick(
  supabase: SupabaseClient,
  businessId: string
): Promise<void> {
  const [{ data: vehicles }, { data: routes }, { data: warehouses }] = await Promise.all([
    supabase
      .from("log_vehicles")
      .select("id, status, gps_provider, last_lat, last_lng")
      .eq("business_id", businessId)
      .eq("status", "active"),
    supabase
      .from("log_routes")
      .select("id, vehicle_id, start_warehouse_id, end_lat, end_lng, status")
      .eq("business_id", businessId)
      .in("status", ["active", "draft"]),
    supabase.from("log_warehouses").select("id, lat, lng").eq("business_id", businessId),
  ]);

  const whCoord = new Map<string, Coord>();
  for (const w of warehouses ?? []) {
    if (typeof w.lat === "number") whCoord.set(w.id, [w.lat, w.lng as number]);
  }
  const anyWarehouse = [...whCoord.values()][0];

  // Best target per vehicle: its active route end, else start warehouse.
  const routeByVehicle = new Map<string, { end?: Coord; start?: Coord }>();
  for (const r of routes ?? []) {
    if (!r.vehicle_id) continue;
    routeByVehicle.set(r.vehicle_id, {
      end: typeof r.end_lat === "number" ? [r.end_lat, r.end_lng as number] : undefined,
      start: r.start_warehouse_id ? whCoord.get(r.start_warehouse_id) : undefined,
    });
  }

  const updates: PromiseLike<unknown>[] = [];
  const nowIso = new Date().toISOString();

  for (const v of (vehicles ?? []).slice(0, 60)) {
    // Only self-drive vehicles that aren't fed by a real GPS provider.
    if (v.gps_provider && v.gps_provider !== "simulated") continue;

    const route = routeByVehicle.get(v.id);
    const target: Coord | undefined = route?.end ?? route?.start ?? anyWarehouse;

    let next: Coord;
    if (typeof v.last_lat !== "number" || typeof v.last_lng !== "number") {
      // No position yet — start it at its route start / a warehouse (with jitter).
      const seed = route?.start ?? anyWarehouse;
      if (!seed) continue;
      next = [seed[0] + (Math.random() - 0.5) * 0.01, seed[1] + (Math.random() - 0.5) * 0.01];
    } else {
      const cur: Coord = [v.last_lat, v.last_lng];
      if (target && haversineKm(cur, target) < ARRIVE_KM) {
        // Arrived — loop back toward the route start (or wander near a warehouse).
        const back = route?.start ?? anyWarehouse ?? cur;
        next = stepToward(cur, back);
      } else if (target) {
        next = stepToward(cur, target);
      } else {
        // No target at all — gentle random walk.
        next = [cur[0] + (Math.random() - 0.5) * STEP_DEG, cur[1] + (Math.random() - 0.5) * STEP_DEG];
      }
    }

    updates.push(
      supabase
        .from("log_vehicles")
        .update({ last_lat: next[0], last_lng: next[1], last_seen_at: nowIso, gps_status: "live" })
        .eq("id", v.id)
    );
  }

  await Promise.all(updates);
}
