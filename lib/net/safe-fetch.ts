/**
 * Fetching a URL a stranger gave us, without letting them aim it inwards.
 *
 * THE HOLE. `isPublicWebHost` is a careful guard — loopback, RFC1918,
 * link-local, cloud metadata, odd ports, single-label intranet names, IPv6
 * literals, all refused. It was applied to the URL the user typed, and then
 * the fetch ran with `redirect: "follow"`.
 *
 * A redirect is a new URL, and nothing re-checked it. So:
 *
 *     user submits   https://attacker.example/
 *     guard says     public host, fine
 *     attacker sends 302 Location: http://169.254.169.254/latest/meta-data/…
 *     node follows   and hands us the response body
 *
 * The guard was never consulted about the second hop. `/api/tools/response-time`
 * and `/api/autoseo` are PUBLIC, unauthenticated free tools, so the attacker
 * needs nothing but the URL — and the body comes back to them in the report.
 *
 * The fix is to stop delegating redirects to fetch. Every hop is followed by
 * hand and re-validated with the same guard, so hop 7 is judged exactly as
 * hop 1 was.
 *
 * NOT FIXED HERE, and logged rather than papered over: DNS rebinding, where a
 * hostname passes the guard and then resolves to a private address. Closing
 * that needs a pinned resolver and a custom agent — a real change to how the
 * app makes outbound connections, which is not a thing to ship overnight.
 * The redirect hole is the one that needs no special infrastructure to
 * exploit.
 */

/**
 * SSRF guard: website URLs arrive from bulk-imported CSVs (scraper output)
 * and from public free-tool forms, so the server must refuse to fetch
 * anything that isn't a public website — loopback/link-local/private
 * addresses, cloud metadata endpoints, bare hostnames and non-standard ports
 * could otherwise probe infrastructure from inside the deployment.
 *
 * Moved here from lib/growth/research.ts so the guard and the fetch that
 * honours it live together. research.ts re-exports it, so every existing
 * import keeps working.
 */
export function isPublicWebHost(u: URL): boolean {
  const host = u.hostname.toLowerCase();
  // Only default web ports.
  if (u.port && !["80", "443"].includes(u.port)) return false;
  // Named hosts must be real public FQDNs: no localhost, no single-label
  // intranet names, no .local/.internal style suffixes.
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".lan")
  ) {
    return false;
  }
  // Note: shorthand IPv4 ("127.1", "10.1") never reaches here as written —
  // the WHATWG URL parser normalises it to dotted-quad first, so the branch
  // below sees 127.0.0.1. Verified rather than assumed.
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    // Loopback, RFC1918 private, link-local/metadata (169.254.x — includes
    // 169.254.169.254), carrier-NAT, 0.x and multicast/reserved.
    if (
      a === 127 || a === 10 || a === 0 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    ) {
      return false;
    }
    return true; // other literal IPs: unusual for an SME site but harmless
  }
  // IPv6 literals ([::1] etc.) — no legitimate SME website is imported this
  // way; refuse them all rather than parse scopes.
  if (host.includes(":")) return false;
  // Must look like a domain with a real TLD.
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host);
}

/** Enough for the www→apex→https shuffles real sites do; short enough that a
 *  redirect loop costs nothing. */
export const MAX_REDIRECTS = 5;

export type SafeFetchResult =
  | { ok: true; response: Response; url: string; hops: number }
  | { ok: false; reason: string; blockedUrl?: string };

/**
 * Resolves the redirect chain by hand, checking EVERY hop against the guard.
 *
 * `redirect: "manual"` is the whole point: with "follow", the check below
 * runs once and the remaining hops are unsupervised.
 */
export async function safeFetch(
  rawUrl: string,
  init: RequestInit = {},
  opts: { maxRedirects?: number; deadline?: number } = {}
): Promise<SafeFetchResult> {
  const maxRedirects = opts.maxRedirects ?? MAX_REDIRECTS;
  let current = rawUrl;
  const seen = new Set<string>();

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    let parsed: URL;
    try {
      parsed = new URL(current);
    } catch {
      return { ok: false, reason: "not a valid URL", blockedUrl: current };
    }
    // Re-checked on every hop, not just the first. A redirect to another
    // protocol (file:, gopher:) is refused here too.
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return { ok: false, reason: "not an http(s) URL", blockedUrl: current };
    }
    if (!isPublicWebHost(parsed)) {
      return {
        ok: false,
        reason: hop === 0 ? "not a public website" : "redirected to a non-public address",
        blockedUrl: current,
      };
    }
    // A loop wastes the whole time budget for nothing.
    if (seen.has(parsed.toString())) {
      return { ok: false, reason: "redirect loop", blockedUrl: current };
    }
    seen.add(parsed.toString());

    if (opts.deadline && Date.now() > opts.deadline) {
      return { ok: false, reason: "out of time" };
    }

    const response = await fetch(parsed.toString(), { ...init, redirect: "manual" });

    // 3xx with a Location is a hop; anything else is the answer.
    const location = response.status >= 300 && response.status < 400
      ? response.headers.get("location")
      : null;
    if (!location) {
      return { ok: true, response, url: parsed.toString(), hops: hop };
    }

    // Relative Locations are legal and common.
    let next: string;
    try {
      next = new URL(location, parsed).toString();
    } catch {
      return { ok: false, reason: "redirect to an unreadable location", blockedUrl: location };
    }
    current = next;
  }

  return { ok: false, reason: `more than ${maxRedirects} redirects`, blockedUrl: current };
}
