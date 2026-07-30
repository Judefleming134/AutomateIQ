import "server-only";
import type { NextRequest } from "next/server";

/**
 * Shared rate limiting for the free public tools (/tools/*).
 *
 * Honest about what it is: each serverless instance keeps its own counters, so
 * the real ceiling is (limit × warm instances) rather than a hard global cap.
 * That's the right trade for these endpoints — it stops one script hammering a
 * free tool without putting a Redis dependency or a database round-trip in
 * front of every visitor. Anything that spends real money per call (AI, paid
 * APIs, outbound email) gets a tight limit here AND a second, stricter one on
 * the expensive operation itself.
 */

type Bucket = { count: number; resetAt: number };

const stores = new Map<string, Map<string, Bucket>>();

function storeFor(name: string): Map<string, Bucket> {
  let s = stores.get(name);
  if (!s) {
    s = new Map();
    stores.set(name, s);
  }
  return s;
}

export type RateVerdict = { allowed: true } | { allowed: false; retryInMs: number };

/**
 * Consumes one unit from `key` in the named bucket. Buckets are independent,
 * so a tool can limit per-IP and per-target separately.
 */
export function consume(
  bucket: string,
  key: string,
  limit: number,
  windowMs: number
): RateVerdict {
  const store = storeFor(bucket);
  const now = Date.now();
  // Opportunistic cleanup so a long-lived instance can't grow unbounded.
  if (store.size > 5000) {
    for (const [k, v] of store) if (v.resetAt < now) store.delete(k);
  }
  const existing = store.get(key);
  if (!existing || existing.resetAt < now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }
  if (existing.count >= limit) {
    return { allowed: false, retryInMs: existing.resetAt - now };
  }
  existing.count++;
  return { allowed: true };
}

export function clientIp(request: NextRequest): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

/** "3 minutes" / "an hour" — for a retry message a person reads. */
export function retryPhrase(ms: number): string {
  const mins = Math.ceil(ms / 60000);
  if (mins <= 1) return "a minute";
  if (mins < 60) return `${mins} minutes`;
  const hours = Math.round(mins / 60);
  return hours === 1 ? "an hour" : `${hours} hours`;
}

/** Normalises whatever was typed into a bare hostname, for per-target limits. */
export function hostKey(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  try {
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return new URL(withScheme).hostname.replace(/^www\./, "");
  } catch {
    return trimmed.slice(0, 120);
  }
}
