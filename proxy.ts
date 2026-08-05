import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Next.js 16 renamed the "middleware" file convention to "proxy" — Proxy
// always runs on the Node.js runtime (unlike the old Edge-only middleware
// convention), which is what fixed a real Vercel deploy warning: importing
// @supabase/supabase-js pulls in a top-level `process.version` feature
// check that Next's Edge Runtime compatibility linter flags as unsupported.
// Node.js runtime supports it natively, so this file must stay named
// proxy.ts (not middleware.ts) — renaming it back would reintroduce the
// warning.
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Allowlist, not a denylist: only the actual app surfaces need a session
  // check. The marketing site (served from /public, including the root
  // route) is never touched by this proxy at all.
  //
  // The last entry is not a session surface. It matches any path whose FIRST
  // segment contains a capital letter, and it exists because the four
  // entries above are exactly why the case-forgiving redirect for brand URLs
  // shipped dead: `/TradeIQ` matches none of them, so canonicalPath() was
  // never reached and every capitalised URL on the site still 404'd —
  // /TradeIQ, /PlanIQ, /FinanceIQ, /Products, /Book, /Systems, all of them.
  //
  // Deliberately narrow rather than the usual catch-all
  // "/((?!api|_next|.*\\..*).*)": a catch-all would route the marketing
  // homepage through a Node function on every visit, turning the site's
  // highest-traffic, fully-static page into an invocation. An all-lowercase
  // URL is already correct and has nothing to gain from being inspected.
  // updateSession() short-circuits before touching Supabase for anything
  // that isn't a session surface, so a capitalised miss costs no auth call.
  matcher: [
    "/portal/:path*",
    "/admin/:path*",
    "/growth/:path*",
    // TradeIQ and Finance are app surfaces too — same account system, both
    // behind requireTradesAccount(). Leaving them out meant updateSession()
    // never ran for a paying TradeIQ customer, so nothing could write their
    // refreshed auth cookie and they were signed out about an hour after
    // signing in. needsSession() excludes /tradeiq/doc, the public
    // token-based customer page, so a sent quote still costs no auth call.
    "/tradeiq/:path*",
    "/finance/:path*",
    "/login",
    "/:segment([^/]*[A-Z][^/]*)/:path*",
  ],
};
