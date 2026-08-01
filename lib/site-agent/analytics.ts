/**
 * Whether a SiteIQ page is doing anything.
 *
 * The page could be published for six months and the only signal the business
 * had was the enquiry list — which is a numerator with no denominator. "Three
 * enquiries" means something completely different out of 40 visits than out of
 * 4,000, and the difference is the difference between "write a better page"
 * and "get people to the page at all". Neither could be told apart.
 *
 * Views are counted per day rather than per visit. A row per visit on a public
 * page is unbounded, and it is a table anyone on the internet can write to.
 */

/**
 * Requests that are not people.
 *
 * A view count inflated by crawlers is worse than no count: the business
 * concludes the page gets traffic and the enquiries are the problem, and
 * rewrites a page nobody was reading. Deliberately conservative — it catches
 * the declared crawlers and leaves everything else counted, because
 * over-filtering hides real visitors just as badly.
 */
const BOT_MARKERS = [
  "bot", "crawler", "spider", "crawl", "slurp",
  "facebookexternalhit", "embedly", "quora link preview",
  "pinterest", "bitlybot", "vkshare", "outbrain",
  "headlesschrome", "phantomjs", "python-requests", "curl/", "wget",
  "go-http-client", "java/", "okhttp", "axios/", "node-fetch",
  "lighthouse", "pagespeed", "gtmetrix", "uptime", "monitor",
  "preview", "scraper", "fetcher", "validator",
];

export function isLikelyBot(userAgent: string | null | undefined): boolean {
  const ua = (userAgent ?? "").toLowerCase();
  // No user-agent at all is a script, not a browser.
  if (!ua.trim()) return true;
  return BOT_MARKERS.some((marker) => ua.includes(marker));
}

export type ViewDay = { day: string; views: number };

export type ViewSummary = {
  views: number;
  enquiries: number;
  /** Enquiries per 100 views, rounded to one decimal. Null when nobody visited. */
  conversionRate: number | null;
  /** The busiest day in the window, or null if nothing happened. */
  busiest: { day: string; views: number } | null;
  /** One entry per day in the window, oldest first, zeros filled in. */
  series: ViewDay[];
  /** Plain-language reading of the two numbers together. */
  verdict: string;
};

/** YYYY-MM-DD in Irish time — the same calendar the rest of the app uses. */
export function dayKey(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin" }).format(at);
}

/**
 * Fills the gaps.
 *
 * A chart drawn only from days that HAVE rows draws a straight line through a
 * fortnight of silence and reads as steady traffic. The zeros are the story.
 */
function fillSeries(rows: ViewDay[], days: number, now: Date): ViewDay[] {
  const counts = new Map(rows.map((r) => [r.day, r.views]));
  const out: ViewDay[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const key = dayKey(new Date(now.getTime() - i * 86_400_000));
    out.push({ day: key, views: counts.get(key) ?? 0 });
  }
  return out;
}

/**
 * Reads the two numbers the way a person would.
 *
 * Deliberately refuses to congratulate a page on a rate calculated from a
 * handful of visits — "100% conversion" off two views is noise, and a product
 * that reports it as a triumph is not trustworthy about anything else.
 */
function readVerdict(views: number, enquiries: number, rate: number | null): string {
  if (views === 0) {
    return "Nobody has visited yet. Put the link on your van, your invoices and your Google profile — the page can't work until people reach it.";
  }
  if (views < 30) {
    return `Only ${views} visit${views === 1 ? "" : "s"} so far — too few to read anything into. Share the link more widely before judging the page.`;
  }
  if (enquiries === 0) {
    return `${views} people looked and nobody got in touch. That points at the page rather than the traffic: check the headline says what you do, and that your phone number is near the top.`;
  }
  if (rate !== null && rate >= 5) {
    return `${enquiries} enquir${enquiries === 1 ? "y" : "ies"} from ${views} visits. That is a page that works — the win now is getting more people to it.`;
  }
  return `${enquiries} enquir${enquiries === 1 ? "y" : "ies"} from ${views} visits. People are arriving; a sharper headline or a clearer offer is what lifts this.`;
}

/**
 * @param rows daily view counts, any order, gaps allowed.
 * @param leadTimestamps when each enquiry arrived, as ISO strings.
 */
export function summariseViews(
  rows: ViewDay[],
  leadTimestamps: string[],
  days = 30,
  now: Date = new Date()
): ViewSummary {
  const series = fillSeries(rows, days, now);
  const window = new Set(series.map((s) => s.day));

  const views = series.reduce((sum, s) => sum + s.views, 0);

  // Counted over the SAME window as the views. Comparing all-time enquiries
  // against 30 days of visits is the count-that-doesn't-match-its-source bug,
  // and here it would flatter the page rather than under-report it.
  const enquiries = leadTimestamps.filter((ts) => {
    const at = new Date(ts);
    return !Number.isNaN(at.getTime()) && window.has(dayKey(at));
  }).length;

  const conversionRate = views > 0 ? Math.round((enquiries / views) * 1000) / 10 : null;

  const busiest = series.reduce<{ day: string; views: number } | null>(
    (best, s) => (s.views > 0 && (!best || s.views > best.views) ? s : best),
    null
  );

  return {
    views,
    enquiries,
    conversionRate,
    busiest,
    series,
    verdict: readVerdict(views, enquiries, conversionRate),
  };
}
