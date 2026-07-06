"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/require-session";
import { requireProductEnabled } from "@/lib/auth/require-product";
import { createClient } from "@/lib/supabase/server";
import { geocodeAddress } from "@/lib/logistics/core";
import { isMissingTableError } from "@/lib/db/errors";

type Result = { ok?: boolean; error?: string } | undefined;

const PRODUCT = "logistics-control-centre";
const NEEDS_MIGRATION =
  "Database update required — run supabase/manual_update_0013.sql in the Supabase SQL Editor, then try again.";

async function ctx() {
  const { profile } = await requireSession();
  const businessId = profile.business_id!;
  const enabled = await requireProductEnabled(businessId, PRODUCT);
  if (!enabled) return null;
  const supabase = await createClient();
  return { businessId, supabase };
}

function fail(error: unknown): Result {
  if (isMissingTableError(error)) return { error: NEEDS_MIGRATION };
  const msg = error && typeof error === "object" && "message" in error ? String((error as { message: unknown }).message) : "Something went wrong.";
  return { error: msg };
}

const num = (v: FormDataEntryValue | null) => {
  const n = parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : null;
};

// --- Warehouses ------------------------------------------------------------
const warehouseSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  address: z.string().trim().max(300).optional().or(z.literal("")),
  wh_type: z.string().trim().max(60).optional().or(z.literal("")),
  contact_name: z.string().trim().max(120).optional().or(z.literal("")),
  contact_phone: z.string().trim().max(60).optional().or(z.literal("")),
  opening_hours: z.string().trim().max(200).optional().or(z.literal("")),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
});

export async function createWarehouse(_prev: Result, formData: FormData): Promise<Result> {
  const c = await ctx();
  if (!c) return { error: "Logistics Control Centre is not enabled for your account." };

  const parsed = warehouseSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;

  let lat = num(formData.get("lat"));
  let lng = num(formData.get("lng"));
  if ((lat === null || lng === null) && d.address) {
    const geo = await geocodeAddress(d.address);
    if (geo) { lat = geo.lat; lng = geo.lng; }
  }

  const { error } = await c.supabase.from("log_warehouses").insert({
    business_id: c.businessId,
    name: d.name,
    address: d.address || "",
    lat, lng,
    wh_type: d.wh_type || "distribution",
    contact_name: d.contact_name || null,
    contact_phone: d.contact_phone || null,
    capacity: num(formData.get("capacity")),
    current_utilisation: num(formData.get("current_utilisation")),
    opening_hours: d.opening_hours || "",
    notes: d.notes || "",
  });
  if (error) return fail(error);
  revalidatePath("/portal/logistics/warehouses");
  revalidatePath("/portal/logistics");
  return { ok: true };
}

export async function deleteWarehouse(id: string): Promise<Result> {
  const c = await ctx();
  if (!c) return { error: "Not enabled." };
  const { error } = await c.supabase.from("log_warehouses").delete().eq("id", id);
  if (error) return fail(error);
  revalidatePath("/portal/logistics/warehouses");
  return { ok: true };
}

// --- Drivers ---------------------------------------------------------------
const driverSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  phone: z.string().trim().max(60).optional().or(z.literal("")),
  email: z.string().trim().max(200).optional().or(z.literal("")),
  license_no: z.string().trim().max(60).optional().or(z.literal("")),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
});

export async function createDriver(_prev: Result, formData: FormData): Promise<Result> {
  const c = await ctx();
  if (!c) return { error: "Not enabled." };
  const parsed = driverSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;
  const { error } = await c.supabase.from("log_drivers").insert({
    business_id: c.businessId,
    name: d.name,
    phone: d.phone || null,
    email: d.email || null,
    license_no: d.license_no || null,
    notes: d.notes || "",
  });
  if (error) return fail(error);
  revalidatePath("/portal/logistics/fleet");
  return { ok: true };
}

export async function deleteDriver(id: string): Promise<Result> {
  const c = await ctx();
  if (!c) return { error: "Not enabled." };
  const { error } = await c.supabase.from("log_drivers").delete().eq("id", id);
  if (error) return fail(error);
  revalidatePath("/portal/logistics/fleet");
  return { ok: true };
}

// --- Vehicles --------------------------------------------------------------
const vehicleSchema = z.object({
  registration: z.string().trim().min(1, "Registration is required"),
  name: z.string().trim().max(120).optional().or(z.literal("")),
  vtype: z.enum(["truck", "van", "lorry", "trailer"]),
  driver_id: z.string().uuid().optional().or(z.literal("")),
  gps_provider: z.string().trim().max(60).optional().or(z.literal("")),
  maintenance_notes: z.string().trim().max(1000).optional().or(z.literal("")),
});

export async function createVehicle(_prev: Result, formData: FormData): Promise<Result> {
  const c = await ctx();
  if (!c) return { error: "Not enabled." };
  const parsed = vehicleSchema.safeParse({
    registration: formData.get("registration"),
    name: formData.get("name") || "",
    vtype: formData.get("vtype") || "van",
    driver_id: formData.get("driver_id") || "",
    gps_provider: formData.get("gps_provider") || "",
    maintenance_notes: formData.get("maintenance_notes") || "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;
  const insuranceExpiry = String(formData.get("insurance_expiry") ?? "").trim();

  const { error } = await c.supabase.from("log_vehicles").insert({
    business_id: c.businessId,
    registration: d.registration,
    name: d.name || null,
    vtype: d.vtype,
    capacity: num(formData.get("capacity")),
    driver_id: d.driver_id || null,
    gps_provider: d.gps_provider || null,
    gps_status: d.gps_provider ? "live" : "manual",
    maintenance_notes: d.maintenance_notes || "",
    insurance_expiry: insuranceExpiry || null,
  });
  if (error) return fail(error);
  revalidatePath("/portal/logistics/fleet");
  revalidatePath("/portal/logistics");
  return { ok: true };
}

export async function setVehicleStatus(id: string, status: string): Promise<Result> {
  const c = await ctx();
  if (!c) return { error: "Not enabled." };
  if (!["active", "idle", "maintenance", "inactive"].includes(status)) return { error: "Invalid status." };
  const { error } = await c.supabase.from("log_vehicles").update({ status }).eq("id", id);
  if (error) return fail(error);
  revalidatePath("/portal/logistics/fleet");
  revalidatePath("/portal/logistics");
  return { ok: true };
}

/** Manual location update for vehicles without a live GPS feed. */
export async function updateVehicleLocation(_prev: Result, formData: FormData): Promise<Result> {
  const c = await ctx();
  if (!c) return { error: "Not enabled." };
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing vehicle." };
  let lat = num(formData.get("lat"));
  let lng = num(formData.get("lng"));
  const address = String(formData.get("address") ?? "").trim();
  if ((lat === null || lng === null) && address) {
    const geo = await geocodeAddress(address);
    if (geo) { lat = geo.lat; lng = geo.lng; }
  }
  if (lat === null || lng === null) return { error: "Enter an address or coordinates." };
  const { error } = await c.supabase
    .from("log_vehicles")
    .update({ last_lat: lat, last_lng: lng, last_seen_at: new Date().toISOString(), gps_status: "manual" })
    .eq("id", id);
  if (error) return fail(error);
  revalidatePath("/portal/logistics/fleet");
  revalidatePath("/portal/logistics");
  return { ok: true };
}

export async function deleteVehicle(id: string): Promise<Result> {
  const c = await ctx();
  if (!c) return { error: "Not enabled." };
  const { error } = await c.supabase.from("log_vehicles").delete().eq("id", id);
  if (error) return fail(error);
  revalidatePath("/portal/logistics/fleet");
  return { ok: true };
}

// --- Routes ----------------------------------------------------------------
const routeSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  start_warehouse_id: z.string().uuid().optional().or(z.literal("")),
  end_address: z.string().trim().max(300).optional().or(z.literal("")),
  driver_id: z.string().uuid().optional().or(z.literal("")),
  vehicle_id: z.string().uuid().optional().or(z.literal("")),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
});

export async function createRoute(_prev: Result, formData: FormData): Promise<Result> {
  const c = await ctx();
  if (!c) return { error: "Not enabled." };
  const parsed = routeSchema.safeParse({
    name: formData.get("name"),
    start_warehouse_id: formData.get("start_warehouse_id") || "",
    end_address: formData.get("end_address") || "",
    driver_id: formData.get("driver_id") || "",
    vehicle_id: formData.get("vehicle_id") || "",
    notes: formData.get("notes") || "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;

  let endLat: number | null = null;
  let endLng: number | null = null;
  if (d.end_address) {
    const geo = await geocodeAddress(d.end_address);
    if (geo) { endLat = geo.lat; endLng = geo.lng; }
  }

  const { error } = await c.supabase.from("log_routes").insert({
    business_id: c.businessId,
    name: d.name,
    start_warehouse_id: d.start_warehouse_id || null,
    end_address: d.end_address || "",
    end_lat: endLat,
    end_lng: endLng,
    driver_id: d.driver_id || null,
    vehicle_id: d.vehicle_id || null,
    notes: d.notes || "",
  });
  if (error) return fail(error);
  revalidatePath("/portal/logistics/routes");
  return { ok: true };
}

export async function setRouteStatus(id: string, status: string): Promise<Result> {
  const c = await ctx();
  if (!c) return { error: "Not enabled." };
  if (!["draft", "active", "completed", "archived"].includes(status)) return { error: "Invalid status." };
  const { error } = await c.supabase.from("log_routes").update({ status }).eq("id", id);
  if (error) return fail(error);
  revalidatePath("/portal/logistics/routes");
  return { ok: true };
}

export async function addRouteStop(_prev: Result, formData: FormData): Promise<Result> {
  const c = await ctx();
  if (!c) return { error: "Not enabled." };
  const routeId = String(formData.get("route_id") ?? "");
  const address = String(formData.get("address") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim();
  if (!routeId || !address) return { error: "Address is required." };

  const geo = await geocodeAddress(address);
  const { count } = await c.supabase
    .from("log_route_stops")
    .select("id", { count: "exact", head: true })
    .eq("route_id", routeId);

  const { error } = await c.supabase.from("log_route_stops").insert({
    route_id: routeId,
    business_id: c.businessId,
    seq: (count ?? 0) + 1,
    label: label || address,
    address,
    lat: geo?.lat ?? null,
    lng: geo?.lng ?? null,
  });
  if (error) return fail(error);
  revalidatePath("/portal/logistics/routes");
  return { ok: true };
}

export async function deleteRoute(id: string): Promise<Result> {
  const c = await ctx();
  if (!c) return { error: "Not enabled." };
  const { error } = await c.supabase.from("log_routes").delete().eq("id", id);
  if (error) return fail(error);
  revalidatePath("/portal/logistics/routes");
  return { ok: true };
}

// --- Deliveries ------------------------------------------------------------
const deliverySchema = z.object({
  customer_name: z.string().trim().min(1, "Customer is required"),
  address: z.string().trim().max(300).optional().or(z.literal("")),
  driver_id: z.string().uuid().optional().or(z.literal("")),
  vehicle_id: z.string().uuid().optional().or(z.literal("")),
  route_id: z.string().uuid().optional().or(z.literal("")),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
});

export async function createDelivery(_prev: Result, formData: FormData): Promise<Result> {
  const c = await ctx();
  if (!c) return { error: "Not enabled." };
  const parsed = deliverySchema.safeParse({
    customer_name: formData.get("customer_name"),
    address: formData.get("address") || "",
    driver_id: formData.get("driver_id") || "",
    vehicle_id: formData.get("vehicle_id") || "",
    route_id: formData.get("route_id") || "",
    notes: formData.get("notes") || "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;

  let lat: number | null = null;
  let lng: number | null = null;
  if (d.address) {
    const geo = await geocodeAddress(d.address);
    if (geo) { lat = geo.lat; lng = geo.lng; }
  }
  const windowStart = String(formData.get("window_start") ?? "").trim();
  const windowEnd = String(formData.get("window_end") ?? "").trim();

  const { error } = await c.supabase.from("log_deliveries").insert({
    business_id: c.businessId,
    customer_name: d.customer_name,
    address: d.address || "",
    lat, lng,
    window_start: windowStart ? new Date(windowStart).toISOString() : null,
    window_end: windowEnd ? new Date(windowEnd).toISOString() : null,
    driver_id: d.driver_id || null,
    vehicle_id: d.vehicle_id || null,
    route_id: d.route_id || null,
    notes: d.notes || "",
  });
  if (error) return fail(error);
  revalidatePath("/portal/logistics/deliveries");
  revalidatePath("/portal/logistics");
  return { ok: true };
}

export async function setDeliveryStatus(id: string, status: string): Promise<Result> {
  const c = await ctx();
  if (!c) return { error: "Not enabled." };
  if (!["scheduled", "in_transit", "delivered", "delayed", "failed"].includes(status)) {
    return { error: "Invalid status." };
  }
  const { error } = await c.supabase.from("log_deliveries").update({ status }).eq("id", id);
  if (error) return fail(error);
  revalidatePath("/portal/logistics/deliveries");
  revalidatePath("/portal/logistics");
  return { ok: true };
}

export async function deleteDelivery(id: string): Promise<Result> {
  const c = await ctx();
  if (!c) return { error: "Not enabled." };
  const { error } = await c.supabase.from("log_deliveries").delete().eq("id", id);
  if (error) return fail(error);
  revalidatePath("/portal/logistics/deliveries");
  return { ok: true };
}
