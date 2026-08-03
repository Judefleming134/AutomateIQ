import "server-only";
import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time comparison of two secrets.
 *
 * A plain `a !== b` returns as soon as two bytes differ, so the time an
 * endpoint takes to answer 401 depends on how much of the secret the caller got
 * right. On a public, guessable URL that leaks the secret prefix-by-prefix.
 *
 * This codebase already treats that as the standard — `lib/cron/auth.ts` uses
 * timingSafeEqual with a comment saying exactly why, and the Resend and
 * Instagram webhooks both compare their HMACs with it. The inbound-email
 * webhook, which is on the reply path, was the one place still using `!==`.
 * Extracted here so the next endpoint has something to reach for rather than a
 * choice to get wrong.
 *
 * Returns false on any length mismatch, which is what timingSafeEqual requires
 * and leaks only the length — never the bytes.
 */
export function secretsMatch(provided: string, expected: string): boolean {
  if (!expected) return false;
  const a = Buffer.from(String(provided ?? ""));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
