/**
 * Where a review link is allowed to send someone without an interstitial.
 *
 * `/api/r/[token]` redirects to whatever a tenant saved as their review link.
 * With no restriction that is an open redirect on automateiq.ie: a customer
 * saves `http://phishing-site.example`, sends the link around, and the victim
 * sees OUR domain in the message and trusts it. The damage lands on Jude's
 * domain reputation, not theirs.
 *
 * The fix is deliberately NOT a hard block. Blocking anything off-list would
 * break a legitimate customer whose review platform simply isn't listed here,
 * and silently breaking a paying customer's review flow is worse than the
 * abuse being prevented. So: known review platforms redirect straight through
 * (no extra click, covers essentially all real use), and anything else goes to
 * an interstitial that names the destination before the visitor continues.
 * Nobody's flow breaks, and the phishing value is gone either way.
 */

/** Hosts (and their subdomains) that are unambiguously review destinations. */
const ALLOWED_SUFFIXES = [
  // Google, in all the shapes a business owner might paste
  "google.com",
  "google.ie",
  "google.co.uk",
  "g.page",
  "goo.gl",
  "maps.app.goo.gl",
  "business.google.com",
  // The other platforms Irish SMEs actually collect reviews on
  "trustpilot.com",
  "facebook.com",
  "fb.com",
  "yelp.com",
  "yelp.ie",
  "checkatrade.com",
  "trustatrader.com",
  "ratedpeople.com",
  "houzz.com",
  "houzz.ie",
  "tripadvisor.com",
  "tripadvisor.ie",
  "bark.com",
  "trustindex.io",
  "reviews.io",
];

/**
 * True when the host is one of the allowed platforms, or a subdomain of one.
 * Matched on the dot boundary so `notgoogle.com` and `google.com.evil.net`
 * are both rejected — a plain `endsWith` would wave the second one through.
 */
export function isKnownReviewHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return ALLOWED_SUFFIXES.some(
    (suffix) => h === suffix || h.endsWith(`.${suffix}`)
  );
}

/**
 * Normalises a saved review link into an absolute https(s) URL, or null.
 * Owners paste these without a scheme constantly ("g.page/…"), and
 * NextResponse.redirect throws on anything that isn't absolute — which would
 * 500 the customer clicking their own review link.
 */
export function normaliseReviewLink(raw: string | null | undefined): URL | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  // A scheme that ISN'T http(s) must be rejected, not prefixed. Blindly gluing
  // "https://" onto anything schemeless turned "file:///etc/passwd" into
  // "https://file//etc/passwd" — which parses cleanly and sails through every
  // check below as a URL with the hostname "file". Harmless in itself, but it
  // means the function silently invents a destination out of input it should
  // have refused, and that is exactly the shape a real bypass takes.
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed);
  if (hasScheme && !/^https?:\/\//i.test(trimmed)) return null;
  const withScheme = hasScheme ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  // Belt and braces: the scheme test above can be satisfied by odd input, and
  // nothing but http/https should ever leave this function.
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  // A review link always lives on a real public host. Requiring a dot rejects
  // single-label junk ("localhost", or whatever a mangled paste produced)
  // before it can reach the interstitial and be shown to a customer as though
  // it were a genuine destination.
  if (!url.hostname.includes(".")) return null;
  return url;
}
