import "server-only";
import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

/**
 * Shared cron authorization. Every cron route is triggered with
 * `Authorization: Bearer <CRON_SECRET>`.
 *
 * Deny when the secret is missing or empty: without this guard an unset
 * CRON_SECRET turns the comparison into the literal string `Bearer undefined`,
 * which anyone could send — exposing the endpoints that send email and mutate
 * data. The comparison is constant-time so the secret can't be recovered by
 * timing the 401 vs 200 response.
 *
 * Behaviour is unchanged when the secret is set correctly, so the live 07:00
 * cron keeps working exactly as before.
 */
export function isAuthorizedCron(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch; the length check leaks only the
  // header length, never the secret's bytes.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
