import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { canonicalPath } from "@/lib/routing/case";

/**
 * Session refresh + coarse UX redirect ONLY. This is NOT the security
 * boundary — every /admin Server Action and Route Handler re-checks the
 * caller's role itself (see lib/auth/require-admin.ts), because Next.js
 * middleware has a real, disclosed bypass history (e.g. CVE-2025-29927,
 * exploitable via a crafted x-middleware-subrequest header). Treat anything
 * gated here as a convenience redirect, not a guarantee.
 */
/**
 * Paths where a session actually matters.
 *
 * The proxy matcher now also routes capitalised URLs here (see proxy.ts), so
 * this function can be reached by a path that wants nothing from Supabase.
 * Everything outside this list must short-circuit BEFORE the client is built:
 * `getUser()` is a network round trip to Supabase Auth on every request, and
 * the marketing site must not pay for one.
 */
function needsSession(path: string): boolean {
  return (
    path.startsWith("/portal") ||
    path.startsWith("/admin") ||
    path.startsWith("/growth") ||
    path === "/login"
  );
}

export async function updateSession(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // FIRST, before any Supabase work. Brand URLs are written with capitals —
  // TradeIQ, PermitIQ, FinanceIQ — so /TradeIQ is what a new customer
  // actually types off a card, and Next routes are case-sensitive. Only the
  // first segment is corrected; signed tokens further down the path are
  // case-sensitive and must never be touched. See lib/routing/case.ts.
  //
  // This used to sit AFTER getUser(), which spent an auth round trip on a
  // request that was about to 308 anyway — and, more to the point, the proxy
  // matcher never routed /TradeIQ here at all, so it never ran. See proxy.ts.
  const canonical = canonicalPath(path);
  if (canonical) {
    const url = request.nextUrl.clone();
    url.pathname = canonical;
    return NextResponse.redirect(url, 308);
  }

  // A capitalised path that isn't a known route (/Nonsense) reaches here and
  // wants nothing from Supabase. Neither does the marketing site.
  if (!needsSession(path)) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: getUser() (not getSession()) re-validates the token against
  // Supabase Auth on every request rather than trusting the cookie alone.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isAppRoute = path.startsWith("/portal") || path.startsWith("/admin");
  // The Growth Engine (internal sales workspace at /growth) has its own
  // login screen — unauthenticated visitors go there, never to the
  // customer /login. requireGrowth() re-checks membership on every action.
  const isGrowthRoute = path.startsWith("/growth") && path !== "/growth/login";

  if (isAppRoute && !user) {
    const redirectUrl = new URL("/login", request.url);
    redirectUrl.searchParams.set("next", path);
    return NextResponse.redirect(redirectUrl);
  }

  if (isGrowthRoute && !user) {
    const redirectUrl = new URL("/growth/login", request.url);
    redirectUrl.searchParams.set("next", path);
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}
