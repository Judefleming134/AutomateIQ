import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Portal-side equivalent of requireAdmin() — re-checked in every /portal
 * Server Action and Route Handler, not just the layout. Returns the
 * verified user plus their profile (role, business_id).
 */
export async function requireSession() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, business_id")
    .eq("id", user.id)
    .single();

  if (!profile?.business_id) {
    // Admin accounts have no business_id and don't belong in /portal.
    redirect("/admin");
  }

  return { user, profile };
}
