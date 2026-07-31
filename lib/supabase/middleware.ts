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
export async function updateSession(request: NextRequest) {
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

  const path = request.nextUrl.pathname;

  // Brand URLs are written with capitals — TradeIQ, PermitIQ, FinanceIQ — so
  // /TradeIQ is what a new customer actually types off a card. Next routes are
  // case-sensitive, so that was a 404. Only the first segment is corrected;
  // signed tokens further down the path are case-sensitive and must never be
  // touched. See lib/routing/case.ts.
  const canonical = canonicalPath(path);
  if (canonical) {
    const url = request.nextUrl.clone();
    url.pathname = canonical;
    return NextResponse.redirect(url, 308);
  }

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
