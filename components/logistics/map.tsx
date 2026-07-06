"use client";

import { useEffect, useRef, useState } from "react";
import { Search, Maximize2, Layers, Loader2, MapPin } from "lucide-react";
import {
  getProviderTiles,
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  MARKER_COLORS,
} from "@/lib/logistics/map-config";

/* eslint-disable @typescript-eslint/no-explicit-any */

export type MapMarker = {
  id: string;
  lat: number;
  lng: number;
  kind: keyof typeof MARKER_COLORS | string;
  label: string;
  sub?: string;
};
export type MapRoute = { id: string; points: [number, number][]; color?: string };

// --- Leaflet CDN loader (one engine for the main map + every mini-map) ------
let leafletPromise: Promise<any> | null = null;
function loadLeaflet(): Promise<any> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if ((window as any).L) return Promise.resolve((window as any).L);
  if (leafletPromise) return leafletPromise;
  leafletPromise = new Promise((resolve, reject) => {
    if (!document.getElementById("leaflet-css")) {
      const link = document.createElement("link");
      link.id = "leaflet-css";
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }
    const script = document.createElement("script");
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.async = true;
    script.onload = () => resolve((window as any).L);
    script.onerror = () => reject(new Error("Map engine failed to load"));
    document.body.appendChild(script);
  });
  return leafletPromise;
}

function markerIcon(L: any, color: string) {
  return L.divIcon({
    className: "log-marker",
    html: `<span class="log-marker-dot" style="background:${color}"></span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

export function LogisticsMap({
  markers = [],
  routes = [],
  center,
  zoom,
  height = 480,
  showSearch = true,
  showLayerToggle = true,
  mini = false,
  className = "",
  onExpand,
}: {
  markers?: MapMarker[];
  routes?: MapRoute[];
  center?: [number, number];
  zoom?: number;
  height?: number;
  showSearch?: boolean;
  showLayerToggle?: boolean;
  mini?: boolean;
  className?: string;
  onExpand?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const layerRef = useRef<{ road: any; satellite: any } | null>(null);
  const overlayRef = useRef<any>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [satellite, setSatellite] = useState(false);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);

  // Init the map once.
  useEffect(() => {
    let cancelled = false;
    loadLeaflet()
      .then((L) => {
        if (cancelled || !containerRef.current || mapRef.current) return;
        const tiles = getProviderTiles();
        const map = L.map(containerRef.current, {
          center: center ?? DEFAULT_CENTER,
          zoom: zoom ?? (mini ? 11 : DEFAULT_ZOOM),
          zoomControl: !mini,
          attributionControl: !mini,
          scrollWheelZoom: !mini,
          dragging: true,
        });
        const road = L.tileLayer(tiles.road.url, {
          attribution: tiles.road.attribution,
          maxZoom: tiles.road.maxZoom,
          subdomains: tiles.road.subdomains ?? "abc",
        }).addTo(map);
        const sat = L.tileLayer(tiles.satellite.url, {
          attribution: tiles.satellite.attribution,
          maxZoom: tiles.satellite.maxZoom,
          subdomains: tiles.satellite.subdomains ?? "abc",
        });
        mapRef.current = map;
        layerRef.current = { road, satellite: sat };
        setStatus("ready");
      })
      .catch(() => !cancelled && setStatus("error"));
    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Draw markers + routes whenever they change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready") return;
    const L = (window as any).L;
    if (overlayRef.current) map.removeLayer(overlayRef.current);
    const group = L.layerGroup();

    for (const m of markers) {
      if (typeof m.lat !== "number" || typeof m.lng !== "number") continue;
      const color = MARKER_COLORS[m.kind] ?? "#3B82F6";
      const marker = L.marker([m.lat, m.lng], { icon: markerIcon(L, color) });
      marker.bindPopup(
        `<strong>${escapeHtml(m.label)}</strong>${m.sub ? `<br/><span style="color:#888">${escapeHtml(m.sub)}</span>` : ""}`
      );
      group.addLayer(marker);
    }
    for (const r of routes) {
      if (r.points.length < 2) continue;
      group.addLayer(L.polyline(r.points, { color: r.color ?? "#3B82F6", weight: 3, opacity: 0.8 }));
    }
    group.addTo(map);
    overlayRef.current = group;

    // Fit to content when we have any, unless an explicit centre was given.
    if (!center) {
      const pts: [number, number][] = [
        ...markers.filter((m) => typeof m.lat === "number").map((m) => [m.lat, m.lng] as [number, number]),
        ...routes.flatMap((r) => r.points),
      ];
      if (pts.length === 1) map.setView(pts[0], mini ? 12 : 12);
      else if (pts.length > 1) map.fitBounds(pts, { padding: [30, 30], maxZoom: mini ? 13 : 14 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markers, routes, status]);

  function toggleSatellite() {
    const map = mapRef.current;
    const layers = layerRef.current;
    if (!map || !layers) return;
    if (satellite) {
      map.removeLayer(layers.satellite);
      layers.road.addTo(map);
    } else {
      map.removeLayer(layers.road);
      layers.satellite.addTo(map);
    }
    setSatellite((v) => !v);
  }

  async function search(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q || searching) return;
    setSearching(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`,
        { headers: { Accept: "application/json" } }
      );
      const data = (await res.json()) as { lat: string; lon: string; display_name: string }[];
      const hit = data?.[0];
      const map = mapRef.current;
      if (hit && map) {
        const L = (window as any).L;
        const lat = parseFloat(hit.lat);
        const lng = parseFloat(hit.lon);
        map.setView([lat, lng], 14);
        L.marker([lat, lng], { icon: markerIcon(L, MARKER_COLORS.search) })
          .addTo(map)
          .bindPopup(escapeHtml(hit.display_name))
          .openPopup();
      }
    } catch {
      /* search is best-effort */
    } finally {
      setSearching(false);
    }
  }

  function fullscreen() {
    if (onExpand) return onExpand();
    const el = containerRef.current?.parentElement;
    if (el?.requestFullscreen) el.requestFullscreen().then(() => mapRef.current?.invalidateSize());
  }

  return (
    <div className={`log-map ${mini ? "log-map-mini" : ""} ${className}`} style={{ height }}>
      <div ref={containerRef} className="log-map-canvas" />

      {status === "loading" && (
        <div className="log-map-overlay">
          <Loader2 size={20} className="book-spin" /> Loading map…
        </div>
      )}
      {status === "error" && (
        <div className="log-map-overlay log-map-fallback">
          <MapPin size={18} />
          <p>Map couldn&apos;t load. Locations:</p>
          <ul>
            {markers.slice(0, 8).map((m) => (
              <li key={m.id}>{m.label}{m.sub ? ` — ${m.sub}` : ""}</li>
            ))}
          </ul>
        </div>
      )}

      {status === "ready" && !mini && (
        <div className="log-map-tools">
          {showSearch && (
            <form className="log-map-search" onSubmit={search}>
              <Search size={14} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search a town, city or address…"
                aria-label="Search location"
              />
              {searching && <Loader2 size={13} className="book-spin" />}
            </form>
          )}
          {showLayerToggle && (
            <button type="button" className="log-map-btn" onClick={toggleSatellite} title="Toggle satellite">
              <Layers size={15} /> {satellite ? "Map" : "Satellite"}
            </button>
          )}
          <button type="button" className="log-map-btn" onClick={fullscreen} title="Fullscreen">
            <Maximize2 size={15} />
          </button>
        </div>
      )}

      {status === "ready" && mini && onExpand && (
        <button type="button" className="log-minimap-expand" onClick={onExpand} title="Expand map">
          <Maximize2 size={13} />
        </button>
      )}
    </div>
  );
}

/** Compact single-location map used on profile panels. Shares the same engine. */
export function MiniMap({
  lat,
  lng,
  label,
  kind = "warehouse",
  height = 180,
  onExpand,
}: {
  lat?: number | null;
  lng?: number | null;
  label: string;
  kind?: string;
  height?: number;
  onExpand?: () => void;
}) {
  if (typeof lat !== "number" || typeof lng !== "number") {
    return (
      <div className="log-map log-map-mini log-minimap-empty" style={{ height }}>
        <MapPin size={16} /> No location set
      </div>
    );
  }
  return (
    <LogisticsMap
      mini
      markers={[{ id: "m", lat, lng, kind, label }]}
      center={[lat, lng]}
      zoom={13}
      height={height}
      showSearch={false}
      showLayerToggle={false}
      onExpand={onExpand}
    />
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
