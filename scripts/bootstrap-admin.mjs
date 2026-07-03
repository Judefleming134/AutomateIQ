#!/usr/bin/env node
/**
 * One-time script to create the first admin user in a fresh AutomateIQ
 * Platform Supabase project. Run this once, manually, after applying the
 * migrations in supabase/migrations/ — not part of the app's runtime code.
 *
 * The admin console (Stage 3) can create every subsequent admin/customer
 * account; this script only exists to bootstrap the very first one, since
 * there is no public signup and no admin account yet to do it from the UI.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/bootstrap-admin.mjs admin@yourcompany.com "a-strong-temp-password"
 */

const [, , email, password] = process.argv;

if (!email || !password) {
  console.error(
    "Usage: node scripts/bootstrap-admin.mjs <email> <password>"
  );
  process.exit(1);
}

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  console.error(
    "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (from your Supabase project's API settings) before running this script."
  );
  process.exit(1);
}

const res = await fetch(`${url}/auth/v1/admin/users`, {
  method: "POST",
  headers: {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    email,
    password,
    email_confirm: true,
    user_metadata: { role: "admin" },
  }),
});

const body = await res.json();

if (!res.ok) {
  console.error("Failed to create admin user:", body);
  process.exit(1);
}

console.log(
  `Admin user created (id: ${body.id}). The database trigger will have created a matching profiles row with role='admin'. Log in at /login with the email/password above, then change the password from the account settings once you're in.`
);
