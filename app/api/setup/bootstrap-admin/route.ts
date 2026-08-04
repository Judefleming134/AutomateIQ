import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { secretsMatch } from "@/lib/security/timing-safe";

/**
 * One-time bootstrap: creates the very first admin account. There's no UI
 * to do this from (the admin console itself requires an admin to exist),
 * so this exists purely to get the platform from zero to one admin.
 *
 * Gated two ways: a SETUP_SECRET the caller must supply, AND a hard check
 * that no admin profile already exists — once the first admin is created,
 * this endpoint permanently refuses to create another, no matter what
 * secret is supplied. Every subsequent admin/customer account is created
 * from inside /admin (Stage 3+), which is properly session/role gated.
 *
 * Usage (once): POST this endpoint with
 *   { "email": "you@yourcompany.com", "secret": "<SETUP_SECRET>" }
 * Supabase sends an invite email letting the account set its own password
 * — nobody, including this script, ever handles a live credential.
 */
export async function POST(request: NextRequest) {
  const setupSecret = process.env.SETUP_SECRET;
  if (!setupSecret) {
    return NextResponse.json(
      { error: "SETUP_SECRET is not configured." },
      { status: 500 }
    );
  }

  const body = await request.json().catch(() => null);
  const email = body?.email;
  const secret = body?.secret;

  if (typeof email !== "string" || !email.includes("@")) {
    return NextResponse.json({ error: "Invalid email." }, { status: 400 });
  }
  // Constant-time: this endpoint mints the FIRST admin, so the secret
  // guarding it is the most valuable one on the platform. The second gate
  // (no admin may already exist) makes it unreachable in production today,
  // but a gate that is currently redundant is not a reason to compare a
  // secret byte-by-byte.
  if (typeof secret !== "string" || !secretsMatch(secret, setupSecret)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const admin = createAdminClient();

  const { count, error: countError } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "admin");

  if (countError) {
    return NextResponse.json({ error: countError.message }, { status: 500 });
  }
  if (count && count > 0) {
    return NextResponse.json(
      { error: "An admin account already exists. This endpoint only creates the first one." },
      { status: 403 }
    );
  }

  // Send the invite link to our own set-password page rather than relying
  // on the Supabase project's Site URL setting (which defaults to
  // localhost:3000 on a fresh project). The URL must also be added to the
  // project's Redirect URLs allow-list or Supabase falls back to Site URL.
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://automateiq.ie";
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { role: "admin" },
    redirectTo: `${siteUrl}/auth/set-password`,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    userId: data.user.id,
    message: "Invite sent. Check the inbox to set a password and sign in at /login.",
  });
}
