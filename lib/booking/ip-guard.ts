import "server-only";
import { createHash } from "node:crypto";

/**
 * Per-origin abuse counting for the public booking endpoint (OUTSTANDING K5).
 *
 * /api/book already limits three bookings per EMAIL per day, and that guard
 * does real work — but a script that varies the address walks straight past
 * it. Every accepted booking holds a calendar slot AND sends two emails, one
 * of them to whatever address the caller typed. Unbounded, that fills the
 * calendar so genuine prospects cannot book, and burns the sending domain's
 * reputation on third parties.
 *
 * WHY A HASH. The only thing stored is used to answer "how many bookings came
 * from the same origin today". That does not need a raw IP, which is personal
 * data and would sit in the table indefinitely. A salted SHA-256 counts
 * identically and cannot be read back.
 */

/**
 * Deliberately higher than the three-per-email limit. An office, a site hut or
 * a co-working space shares one address, and two colleagues booking sessions
 * on the same afternoon is a good day, not an attack. This is a ceiling on
 * scripted abuse, not a quota.
 */
export const IP_BOOKING_LIMIT = 8;
export const IP_BOOKING_WINDOW_HOURS = 24;

/** Fallback when BOOKING_IP_SALT is unset — see hashIp. */
const FALLBACK_SALT = "automateiq-booking-v1";

/**
 * Salted hash of a client address.
 *
 * With BOOKING_IP_SALT set this is irreversible. WITHOUT it, the constant
 * fallback still de-identifies the column at rest but is brute-forceable
 * across the IPv4 space by anyone already holding the database — which is
 * stated plainly here and in the migration rather than implied to be more
 * than it is. Setting the env var is a one-line improvement.
 */
export function hashIp(ip: string | null | undefined): string | null {
  const value = (ip ?? "").trim();
  if (!value) return null;
  const salt = process.env.BOOKING_IP_SALT || FALLBACK_SALT;
  return createHash("sha256").update(`${salt}:${value}`).digest("hex");
}

/**
 * First address in an X-Forwarded-For chain, which is the client; the rest are
 * proxies. Falls back to the platform's own header.
 *
 * Returns null rather than a placeholder when there is nothing usable: an
 * unknown origin must never be counted, and must never be BLOCKED either —
 * lumping every address-less request under one key would let the first few
 * lock out all the others.
 */
export function clientAddress(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || null;
}

/**
 * Whether this many bookings from one origin inside the window is abuse.
 * Pure, so the threshold is testable without a database.
 */
export function overIpLimit(recentCount: number): boolean {
  return recentCount >= IP_BOOKING_LIMIT;
}
