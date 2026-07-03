import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Allowlist, not a denylist: only the actual app surfaces need a session
  // check. The marketing site (served from /public, including the root
  // route) is never touched by this middleware at all.
  matcher: ["/portal/:path*", "/admin/:path*", "/login"],
};
