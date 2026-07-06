import "server-only";

import { z } from "zod";
import type { AgentModule } from "@/lib/agents/types";
import { computeKpis } from "@/lib/logistics/core";

const vehicleQuery = z.object({ query: z.string().trim().min(1).max(120) });

function sanitizeIlike(q: string) {
  return q.replace(/[,()%]/g, " ").trim();
}

/**
 * AI Logistics Control Centre — registered as a specialist agent so the AI
 * Assistant discovers its tools and delegates logistics questions to it
 * ("where is Truck 12?", "show delayed deliveries"). Every tool reads the
 * business's own RLS-scoped logistics data, so the assistant and the Control
 * Centre always agree.
 */
export const logisticsAgentModule: AgentModule = {
  key: "logistics-control-centre",
  name: "AI Logistics Control Centre",
  version: "1.0",
  category: "operations",
  description:
    "An enterprise logistics platform — live fleet tracking, warehouses, routes and deliveries on one map, with AI route, delay and capacity intelligence.",
  iconName: "truck",
  accent: "#FB7185",
  href: "/portal/logistics",
  availability: "live",
  capabilities: [
    "Live fleet & delivery map",
    "Warehouses, vehicles, drivers, routes & deliveries",
    "Fleet, warehouse, driver & business KPIs",
    "GPS-provider ready (Samsara, Geotab, Traccar…)",
    "The AI Assistant answers 'where is Truck 12?' and more",
  ],
  tools: [
    {
      name: "where_is_vehicle",
      description:
        "Find a vehicle's last known location and status by its registration or name (e.g. 'Truck 12'). Use for questions like 'where is Truck 12?'.",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string", description: "Vehicle registration or name." } },
        required: ["query"],
      },
      execute: async (ctx, input) => {
        const parsed = vehicleQuery.safeParse(input);
        if (!parsed.success) return "Error: give me a vehicle registration or name.";
        const q = sanitizeIlike(parsed.data.query);
        const { data } = await ctx.supabase
          .from("log_vehicles")
          .select("registration, name, status, gps_status, last_lat, last_lng, last_seen_at, log_drivers(name)")
          .or(`registration.ilike.%${q}%,name.ilike.%${q}%`)
          .limit(1)
          .maybeSingle();
        if (!data) return `No vehicle matching "${q}".`;
        const driver = data.log_drivers as unknown as { name: string } | null;
        const loc =
          typeof data.last_lat === "number"
            ? `at ${data.last_lat.toFixed(4)}, ${data.last_lng?.toFixed(4)} (last seen ${data.last_seen_at ? new Date(data.last_seen_at).toLocaleString("en-IE") : "unknown"})`
            : "has no recorded location yet";
        return `${data.name || data.registration} (${data.registration}) is ${data.status}, GPS ${data.gps_status}, driver ${driver?.name ?? "unassigned"} — ${loc}.`;
      },
    },
    {
      name: "list_delayed_deliveries",
      description:
        "List deliveries that are delayed or failed and need attention. Use for 'show delayed deliveries' or delivery-problem questions.",
      inputSchema: { type: "object", properties: {} },
      execute: async (ctx) => {
        const { data } = await ctx.supabase
          .from("log_deliveries")
          .select("customer_name, address, status, log_drivers(name)")
          .in("status", ["delayed", "failed"])
          .order("created_at", { ascending: false })
          .limit(15);
        if (!data || data.length === 0) return "No delayed or failed deliveries right now.";
        return data
          .map((d) => {
            const dr = d.log_drivers as unknown as { name: string } | null;
            return `${d.customer_name} (${d.status}) — ${d.address || "no address"}${dr ? `, driver ${dr.name}` : ""}`;
          })
          .join("\n");
      },
    },
    {
      name: "busiest_warehouse",
      description:
        "Identify the busiest warehouse by capacity utilisation. Use for 'which warehouse is busiest?'.",
      inputSchema: { type: "object", properties: {} },
      execute: async (ctx) => {
        const { data } = await ctx.supabase
          .from("log_warehouses")
          .select("name, capacity, current_utilisation");
        if (!data || data.length === 0) return "No warehouses set up yet.";
        const ranked = data
          .map((w) => ({
            name: w.name,
            pct: Number(w.capacity) > 0 ? Math.round((Number(w.current_utilisation) / Number(w.capacity)) * 100) : 0,
          }))
          .sort((a, b) => b.pct - a.pct);
        const top = ranked[0];
        return `Busiest warehouse: ${top.name} at ${top.pct}% capacity. Full ranking: ${ranked.map((r) => `${r.name} ${r.pct}%`).join(", ")}.`;
      },
    },
    {
      name: "driver_performance",
      description:
        "Rank drivers by completed deliveries. Use for 'which driver is most efficient?' or driver performance questions.",
      inputSchema: { type: "object", properties: {} },
      execute: async (ctx) => {
        const [{ data: drivers }, { data: deliveries }] = await Promise.all([
          ctx.supabase.from("log_drivers").select("id, name"),
          ctx.supabase.from("log_deliveries").select("driver_id, status"),
        ]);
        if (!drivers || drivers.length === 0) return "No drivers set up yet.";
        const counts = new Map<string, { done: number; total: number }>();
        for (const d of deliveries ?? []) {
          if (!d.driver_id) continue;
          const c = counts.get(d.driver_id) ?? { done: 0, total: 0 };
          c.total += 1;
          if (d.status === "delivered") c.done += 1;
          counts.set(d.driver_id, c);
        }
        const ranked = drivers
          .map((dr) => {
            const c = counts.get(dr.id) ?? { done: 0, total: 0 };
            return { name: dr.name, done: c.done, rate: c.total > 0 ? Math.round((c.done / c.total) * 100) : 0 };
          })
          .sort((a, b) => b.done - a.done);
        return `Driver performance (completed deliveries): ${ranked.map((r) => `${r.name} — ${r.done} done, ${r.rate}% success`).join("; ")}.`;
      },
    },
    {
      name: "logistics_kpis",
      description:
        "Get the current logistics KPI summary — fleet, warehouse, delivery and on-time metrics. Use for overall logistics performance questions or predicting volume trends.",
      inputSchema: { type: "object", properties: {} },
      execute: async (ctx) => {
        const k = await computeKpis(ctx.supabase);
        return [
          `Fleet: ${k.vehiclesActive}/${k.vehiclesTotal} active (${k.fleetUtilisation}% utilisation), ${k.vehiclesMaintenance} in maintenance.`,
          `Warehouses: ${k.warehouses}, ${k.warehouseCapacityUsed}% capacity used.`,
          `Deliveries: ${k.deliveriesTotal} total — ${k.deliveriesInTransit} in transit, ${k.deliveriesDelivered} delivered, ${k.deliveriesDelayed} delayed, ${k.deliveriesFailed} failed, ${k.deliveriesScheduled} scheduled.`,
          `On-time rate: ${k.onTimeRate}%. Active routes: ${k.activeRoutes}.`,
        ].join("\n");
      },
    },
    {
      name: "routes_to_optimise",
      description:
        "Suggest which routes to review or optimise, based on stop count and distance. Use for 'which routes should be optimised?'.",
      inputSchema: { type: "object", properties: {} },
      execute: async (ctx) => {
        const [{ data: routes }, { count: stopCount }] = await Promise.all([
          ctx.supabase.from("log_routes").select("id, name, distance_km, status").in("status", ["draft", "active"]),
          ctx.supabase.from("log_route_stops").select("id", { count: "exact", head: true }),
        ]);
        if (!routes || routes.length === 0) return "No active routes to review.";
        const { data: stops } = await ctx.supabase.from("log_route_stops").select("route_id");
        const stopsPer = new Map<string, number>();
        for (const s of stops ?? []) stopsPer.set(s.route_id, (stopsPer.get(s.route_id) ?? 0) + 1);
        const ranked = routes
          .map((r) => ({ name: r.name, stops: stopsPer.get(r.id) ?? 0, km: Number(r.distance_km) || 0 }))
          .sort((a, b) => b.stops + b.km / 50 - (a.stops + a.km / 50));
        void stopCount;
        return `Routes worth reviewing first (most stops/longest): ${ranked.slice(0, 5).map((r) => `${r.name} (${r.stops} stops${r.km ? `, ${Math.round(r.km)}km` : ""})`).join("; ")}. Consider re-sequencing stops and balancing across vehicles.`;
      },
    },
  ],
};
