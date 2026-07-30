import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed, self-contained tokens for the free tools.
 *
 * The response-time test needs to know WHEN an enquiry was sent in order to
 * time it — but a public tool shouldn't need a database table (and a
 * migration) to hold a number that the token can carry itself. The payload is
 * signed, so the clock can't be rewound by editing the link, and it expires,
 * so an old link can't be replayed to fake an impressive result.
 *
 * Never put anything secret in here: the payload is signed, not encrypted.
 */

function secret(): string {
  // A dedicated secret if one is set; otherwise fall back to a server-only key
  // that always exists in a deployed environment. Server-side HMAC only — the
  // key is never sent anywhere.
  const key =
    process.env.TOOLS_TOKEN_SECRET ||
    process.env.CRON_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("NO_TOKEN_SECRET");
  return key;
}

const b64url = (b: Buffer) => b.toString("base64url");

export function signToken(payload: Record<string, string | number>): string {
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(createHmac("sha256", secret()).update(body).digest());
  return `${body}.${sig}`;
}

export function readToken<T extends Record<string, unknown>>(
  token: string,
  maxAgeMs: number
): T | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  let expected: string;
  try {
    expected = b64url(createHmac("sha256", secret()).update(body).digest());
  } catch {
    return null;
  }
  // Constant-time compare — a length mismatch is rejected before the compare,
  // since timingSafeEqual throws on unequal buffers.
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const issued = Number(parsed.t);
  if (!Number.isFinite(issued)) return null;
  const age = Date.now() - issued;
  // Reject a future timestamp too: a clock that reads ahead would otherwise
  // produce a negative elapsed time and a nonsense result.
  if (age < -60_000 || age > maxAgeMs) return null;
  return parsed as T;
}
