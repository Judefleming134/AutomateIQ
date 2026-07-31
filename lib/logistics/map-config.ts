/**
 * Map provider abstraction for the FleetIQ.
 *
 * One rendering engine (Leaflet) with a swappable tile provider, so the map
 * behaves identically whether it's drawing OpenStreetMap, Mapbox or Google
 * raster tiles — no provider is hardcoded. Select the provider with
 * NEXT_PUBLIC_MAP_PROVIDER ("osm" | "mapbox" | "google"); Mapbox/Google use
 * NEXT_PUBLIC_MAPBOX_TOKEN / NEXT_PUBLIC_GOOGLE_MAPS_KEY. Everything falls back
 * to OpenStreetMap so the map always works with zero configuration.
 *
 * Real roads, towns, cities, addresses, place names and coordinates come from
 * the provider's tiles + labels; scale adjusts with Leaflet's zoom.
 */

export type MapProvider = "osm" | "mapbox" | "google";

export type TileLayerConfig = {
  url: string;
  attribution: string;
  maxZoom: number;
  subdomains?: string;
};

export type ProviderTiles = {
  road: TileLayerConfig;
  satellite: TileLayerConfig;
  label: string;
};

const OSM: ProviderTiles = {
  label: "OpenStreetMap",
  road: {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 19,
    subdomains: "abc",
  },
  // Esri World Imagery — free satellite basemap that works with Leaflet.
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "&copy; Esri, Maxar, Earthstar Geographics",
    maxZoom: 19,
  },
};

function mapboxTiles(token: string): ProviderTiles {
  return {
    label: "Mapbox",
    road: {
      url: `https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/{z}/{x}/{y}?access_token=${token}`,
      attribution: "&copy; Mapbox &copy; OpenStreetMap",
      maxZoom: 20,
    },
    satellite: {
      url: `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/tiles/{z}/{x}/{y}?access_token=${token}`,
      attribution: "&copy; Mapbox &copy; Maxar",
      maxZoom: 20,
    },
  };
}

function googleTiles(): ProviderTiles {
  // Google's raster tiles (road + hybrid). Google's official JS SDK is a
  // separate engine; these lyrs endpoints let the same Leaflet engine render
  // Google tiles so the provider can be swapped without a rebuild.
  return {
    label: "Google",
    road: {
      url: "https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}",
      attribution: "&copy; Google",
      maxZoom: 20,
      subdomains: "0123",
    },
    satellite: {
      url: "https://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}",
      attribution: "&copy; Google",
      maxZoom: 20,
      subdomains: "0123",
    },
  };
}

/** Resolve the active provider's tiles from public env, defaulting to OSM. */
export function getProviderTiles(): ProviderTiles {
  const provider = (process.env.NEXT_PUBLIC_MAP_PROVIDER ?? "osm") as MapProvider;
  if (provider === "mapbox") {
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (token) return mapboxTiles(token);
    return OSM; // no token → safe fallback
  }
  if (provider === "google") {
    return googleTiles();
  }
  return OSM;
}

// Sensible default view (Ireland) when a business has no located entities yet.
export const DEFAULT_CENTER: [number, number] = [53.35, -7.7];
export const DEFAULT_ZOOM = 7;

/** Marker kinds → brand colour, so every map reads consistently. */
export const MARKER_COLORS: Record<string, string> = {
  warehouse: "#3B82F6",
  vehicle: "#34D399",
  vehicle_idle: "#6F6F7A",
  vehicle_maintenance: "#FB923C",
  delivery: "#A78BFA",
  delivery_delayed: "#FB923C",
  delivery_failed: "#F87171",
  delivery_delivered: "#34D399",
  stop: "#22D3EE",
  search: "#F472B6",
};
