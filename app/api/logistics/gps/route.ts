import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GPS ingest endpoint — the plug-in point for real fleet-tracking providers
 * (Samsara, Geotab, Verizon Connect, Teltonika, Traccar, custom). A provider
 * adapter posts a position here, authenticated by the business's ingest token
 * (never exposed to the frontend beyond showing the owner their own token).
 *
 * Auth: `Authorization: Bearer <token>` or `x-ingest-token: <token>` or
 * `?token=`. The token maps to exactly one business, so a position can only
 * ever update that business's own vehicle — no business_id is trusted from the
 * request body.
 *
 * Body: { registration | vehicle_id, lat, lng, provider? }
 */
const bodySchema = z.object({
  vehicle_id: z.string().uuid().optional(),
  registration: z.string().trim().max(60).optional(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  provider: z.string().trim().max(60).optional(),
});

function extractToken(request: NextRequest): string | null {
  const auth = request.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  const header = request.headers.get("x-ingest-token");
  if (header) return header.trim();
  const q = request.nextUrl.searchParams.get("token");
  return q ? q.trim() : null;
}

export async function POST(request: NextRequest) {
  const token = extractToken(request);
  if (!token) return NextResponse.json({ error: "Missing ingest token" }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid position payload" }, { status: 400 });
  }
  const d = parsed.data;
  if (!d.vehicle_id && !d.registration) {
    return NextResponse.json({ error: "Provide vehicle_id or registration" }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Token → business (single source of trust; body business_id is ignored).
  const { data: settings } = await supabase
    .from("log_settings")
    .select("business_id")
    .eq("ingest_token", token)
    .maybeSingle();
  if (!settings) return NextResponse.json({ error: "Invalid ingest token" }, { status: 401 });

  let query = supabase
    .from("log_vehicles")
    .update({
      last_lat: d.lat,
      last_lng: d.lng,
      last_seen_at: new Date().toISOString(),
      gps_status: "live",
      ...(d.provider ? { gps_provider: d.provider } : {}),
    })
    .eq("business_id", settings.business_id);
  query = d.vehicle_id ? query.eq("id", d.vehicle_id) : query.eq("registration", d.registration!);

  const { data: updated, error } = await query.select("id").maybeSingle();
  if (error) {
    console.error("GPS ingest update failed:", error);
    return NextResponse.json({ error: "Update failed" }, { status: 502 });
  }
  if (!updated) {
    return NextResponse.json({ error: "No matching vehicle for this account" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, vehicle_id: updated.id });
}
