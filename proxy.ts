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
  matcher: ["/portal/:path*", "/admin/:path*", "/growth/:path*", "/login"],
};
