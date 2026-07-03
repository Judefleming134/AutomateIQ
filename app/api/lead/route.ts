import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Public marketing-site lead capture (see public/index.html's #access
 * form). Deliberately does NOT use lib/supabase/admin.ts's
 * createAdminClient() — that helper's contract is "only call from code
 * already gated by requireAdmin()", which doesn't apply here since this
 * endpoint is intentionally public. Uses its own service-role client
 * instead, same as the api/lead.js function it replaces.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const email = String(
    (body as { email?: unknown } | null)?.email ?? ""
  ).trim();

  if (!EMAIL_PATTERN.test(email)) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json(
      { error: "Server not configured" },
      { status: 500 }
    );
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error } = await supabase
    .from("leads")
    .insert({ email, source: "automateiq-landing" });

  if (error) {
    return NextResponse.json(
      { error: "Store failed", detail: error.message },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true });
}
