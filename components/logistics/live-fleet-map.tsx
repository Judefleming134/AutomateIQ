"use client";

import { useEffect, useState } from "react";
import { LogisticsMap, type MapMarker, type MapRoute } from "./map";

type LiveVehicle = {
  id: string;
  registration: string;
  name: string | null;
  status: string;
  last_lat: number | null;
  last_lng: number | null;
  gps_status: string;
};

function toMarker(v: LiveVehicle): MapMarker | null {
  if (typeof v.last_lat !== "number" || typeof v.last_lng !== "number") return null;
  const kind = v.status === "idle" ? "vehicle_idle" : v.status === "maintenance" ? "vehicle_maintenance" : "vehicle";
  return {
    id: `v-${v.id}`,
    lat: v.last_lat,
    lng: v.last_lng,
    kind,
    label: v.registration,
    sub: `${v.name ?? "Vehicle"} · ${v.status}${v.gps_status === "live" ? " · live" : ""}`,
  };
}

/**
 * The overview map, made live: static markers (warehouses, deliveries) plus a
 * vehicle layer that polls /api/logistics/positions every few seconds. When
 * the business has live tracking on, the server advances simulated vehicles on
 * each poll, so the fleet visibly moves with no external GPS feed.
 */
export function LiveFleetMap({
  staticMarkers,
  initialVehicles,
  routes = [],
  height = 520,
  poll = true,
}: {
  staticMarkers: MapMarker[];
  initialVehicles: LiveVehicle[];
  routes?: MapRoute[];
  height?: number;
  poll?: boolean;
}) {
  const [vehicles, setVehicles] = useState<MapMarker[]>(
    initialVehicles.map(toMarker).filter((m): m is MapMarker => m !== null)
  );

  useEffect(() => {
    if (!poll) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    async function tick() {
      try {
        const res = await fetch("/api/logistics/positions", { method: "POST" });
        if (res.ok) {
          const data = (await res.json()) as { vehicles: LiveVehicle[] };
          if (!stopped && Array.isArray(data.vehicles)) {
            setVehicles(data.vehicles.map(toMarker).filter((m): m is MapMarker => m !== null));
          }
        }
      } catch {
        /* transient — keep last positions */
      }
      if (!stopped) timer = setTimeout(tick, 4000);
    }

    timer = setTimeout(tick, 4000);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [poll]);

  return <LogisticsMap markers={[...staticMarkers, ...vehicles]} routes={routes} height={height} />;
}
