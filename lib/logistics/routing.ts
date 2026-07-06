/**
 * Road-snapped route geometry. Given an ordered list of [lat, lng] waypoints
 * (a route's start warehouse, its stops, and its destination), this asks a
 * public OSRM routing server for the real driving path — the exact roads a
 * vehicle would take — and returns it as [lat, lng] points ready to draw as a
 * polyline. If routing is unavailable it returns null and callers fall back to
 * a straight line, so the map is never broken.
 *
 * Client-safe (no "server-only"): the map component resolves geometry in the
 * browser and caches it, so the fleet route follows motorways and streets
 * instead of cutting diagonally across the country.
 */

export type LatLng = [number, number];

// Public OSRM demo server by default; override with a self-hosted/commercial
// routing host in production via NEXT_PUBLIC_OSRM_URL for higher limits.
const OSRM_BASE =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_OSRM_URL) ||
  "https://router.project-osrm.org";

export async function fetchRoadGeometry(
  points: LatLng[],
  signal?: AbortSignal
): Promise<LatLng[] | null> {
  if (points.length < 2) return null;
  // OSRM wants lng,lat pairs, semicolon-separated.
  const coords = points
    .map(([lat, lng]) => `${lng.toFixed(6)},${lat.toFixed(6)}`)
    .join(";");
  const url = `${OSRM_BASE}/route/v1/driving/${coords}?overview=full&geometries=geojson`;
  try {
    const res = await fetch(url, { signal, headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      code?: string;
      routes?: { geometry?: { coordinates?: [number, number][] } }[];
    };
    if (data.code !== "Ok") return null;
    const coordsOut = data.routes?.[0]?.geometry?.coordinates;
    if (!coordsOut || coordsOut.length < 2) return null;
    // GeoJSON is [lng, lat] — flip back to [lat, lng] for Leaflet.
    return coordsOut.map(([lng, lat]) => [lat, lng] as LatLng);
  } catch {
    return null;
  }
}
