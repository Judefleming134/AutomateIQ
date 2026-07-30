import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { runSeoAudit, isAuditFailure } from "@/lib/seo/audit";

export const runtime = "nodejs";
// The audit budgets itself to ~20s internally; give the platform headroom
// above that so a slow site returns a real answer rather than a 504.
export const maxDuration = 30;

const bodySchema = z.object({ url: z.string().trim().min(3).max(300) });

/**
 * Public, free, unauthenticated: the engine behind automateiq.ie/autoseo.
 *
 * Two things make an open URL-fetching endpoint safe enough to expose:
 * runSeoAudit refuses anything that isn't a public web host (no localhost, no
 * private ranges, no cloud metadata), and the rate limits below stop it being
 * used as a free scanning proxy.
 */

/**
 * In-memory rate limiting. Honest about what it is: each serverless instance
 * keeps its own counters, so the real ceiling is (limit × warm instances)
 * rather than a hard global cap. That's fine for the job — it stops a script
 * hammering the endpoint from one machine without adding a Redis dependency
 * or a database round-trip to every free audit. If abuse ever becomes real,
 * this is the function to move behind a shared store.
 */
type Bucket = { count: number; resetAt: number };
const ipBuckets = new Map<string, Bucket>();
const hostBuckets = new Map<string, Bucket>();

const IP_LIMIT = 12;
const IP_WINDOW_MS = 10 * 60 * 1000;
/** Per target site, across everyone — nobody needs to scan one site 20×/hour. */
const HOST_LIMIT = 8;
const HOST_WINDOW_MS = 60 * 60 * 1000;

function take(map: Map<string, Bucket>, key: string, limit: number, windowMs: number) {
  const now = Date.now();
  // Opportunistic cleanup so the maps can't grow without bound on a long-lived
  // instance. Cheap: only runs when the map is already large.
  if (map.size > 5000) {
    for (const [k, v] of map) if (v.resetAt < now) map.delete(k);
  }
  const existing = map.get(key);
  if (!existing || existing.resetAt < now) {
    map.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryInMs: 0 };
  }
  if (existing.count >= limit) {
    return { allowed: false, retryInMs: existing.resetAt - now };
  }
  existing.count++;
  return { allowed: true, retryInMs: 0 };
}

function clientIp(request: NextRequest): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a website address." }, { status: 400 });
  }

  const ip = take(ipBuckets, clientIp(request), IP_LIMIT, IP_WINDOW_MS);
  if (!ip.allowed) {
    return NextResponse.json(
      {
        error: `That's ${IP_LIMIT} checks in a short window — give it ${Math.ceil(
          ip.retryInMs / 60000
        )} minutes and go again. The tool is free, it just can't be hammered.`,
      },
      { status: 429 }
    );
  }

  // Rate limit per target host too, so the endpoint can't be pointed at one
  // site repeatedly from many addresses.
  let hostKey = parsed.data.url.toLowerCase();
  try {
    const withScheme = /^https?:\/\//i.test(hostKey) ? hostKey : `https://${hostKey}`;
    hostKey = new URL(withScheme).hostname.replace(/^www\./, "");
  } catch {
    // Not parseable — runSeoAudit will reject it properly in a moment.
  }
  const host = take(hostBuckets, hostKey, HOST_LIMIT, HOST_WINDOW_MS);
  if (!host.allowed) {
    return NextResponse.json(
      { error: "That site has been checked several times in the last hour. Try again shortly." },
      { status: 429 }
    );
  }

  let result;
  try {
    result = await runSeoAudit(parsed.data.url);
  } catch {
    // runSeoAudit is written not to throw, but a public endpoint should never
    // return a stack trace shaped as a 500 if that ever stops being true.
    return NextResponse.json(
      { error: "Something went wrong reading that site. Try again in a moment." },
      { status: 502 }
    );
  }

  if (isAuditFailure(result)) {
    return NextResponse.json({ error: result.message, reason: result.error }, { status: 422 });
  }
  return NextResponse.json(result);
}
