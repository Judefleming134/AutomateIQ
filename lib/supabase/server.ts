import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Server-side Supabase client (Server Components, Server Actions, Route
 * Handlers) — reads/writes the session via cookies. Uses the anon key; RLS
 * enforces access, this client is subject to it like any authenticated
 * user's session.
 *
 * Server Components can't set cookies, so the setAll call is wrapped in a
 * try/catch per Supabase's documented pattern — session refresh there is
 * instead handled by middleware.ts, which *can* write response cookies.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component — middleware refreshes the
            // session instead, so this is safe to ignore.
          }
        },
      },
    }
  );
}
