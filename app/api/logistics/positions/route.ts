import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { requireProductEnabled } from "@/lib/auth/require-product";
import { createClient } from "@/lib/supabase/server";
import { runSimulationTick } from "@/lib/logistics/sim";

/**
 * Live vehicle positions for the caller's business. The map polls this to
 * animate the fleet. When live simulation is on, it advances the simulated
 * vehicles a tick first (self-running tracking); real-provider vehicles are
 * updated out-of-band by /api/logistics/gps. Session-authenticated and
 * RLS-scoped, so it only ever returns the caller's own fleet.
 */
export async function POST() {
  const { profile } = await requireSession();
  const businessId = profile.business_id!;

  const enabled = await requireProductEnabled(businessId, "logistics-control-centre");
  if (!enabled) {
    return NextResponse.json({ error: "Not enabled" }, { status: 403 });
  }

  const supabase = await createClient();

  const { data: settings } = await supabase
    .from("log_settings")
    .select("live_sim")
    .eq("business_id", businessId)
    .maybeSingle();

  if (settings?.live_sim) {
    try {
      await runSimulationTick(supabase, businessId);
    } catch (err) {
      console.error("Logistics sim tick failed:", err);
    }
  }

  const { data: vehicles } = await supabase
    .from("log_vehicles")
    .select("id, registration, name, status, last_lat, last_lng, gps_status")
    .not("last_lat", "is", null);

  return NextResponse.json({
    live: Boolean(settings?.live_sim),
    vehicles: vehicles ?? [],
  });
}
