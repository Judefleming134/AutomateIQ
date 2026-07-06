import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Re-checked inside EVERY /admin Server Action and Route Handler — not just
 * once in a layout. Middleware/layouts are UX-routing, not the security
 * boundary (see lib/supabase/middleware.ts for why). Returns the verified
 * admin user, or redirects to /login.
 */
export async function requireAdmin() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") {
    // Growth Engine team accounts (role 'growth', no business_id) belong at
    // /growth — sending them to /portal would bounce them straight back
    // here forever (requireSession redirects business-less accounts to
    // /admin).
    redirect(profile?.role === "growth" ? "/growth" : "/portal");
  }

  return user;
}
