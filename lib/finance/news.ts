import "server-only";

/**
 * Free industry news for the Finance tool — aggregated from publishers' own
 * public RSS feeds, so there are no API keys, no subscriptions and no cost.
 * Headlines link straight to the original publisher. Each feed is fetched
 * with a short timeout and cached (Next revalidate) for 30 minutes; a feed
 * being down never breaks the page — it's just skipped.
 */

export type NewsItem = {
  title: string;
  link: string;
  source: string;
  publishedAt: string | null; // ISO
};

type Feed = { name: string; url: string; tags: string[] };

// Curated free feeds. Tags decide which appear for which trade; "business"
// feeds show for everyone. Additions are one line here.
const FEEDS: Feed[] = [
  { name: "RTÉ Business", url: "https://www.rte.ie/feeds/rss/?index=/news/business/", tags: ["business"] },
  { name: "BBC Business", url: "https://feeds.bbci.co.uk/news/business/rss.xml", tags: ["business"] },
  { name: "The Journal Business", url: "https://www.thejournal.ie/business/feed/", tags: ["business"] },
  { name: "Irish Construction News", url: "https://constructionnews.ie/feed/", tags: ["construction"] },
  { name: "Irish Building Magazine", url: "https://irishbuildingmagazine.ie/feed/", tags: ["construction"] },
  { name: "Silicon Republic", url: "https://www.siliconrepublic.com/feed", tags: ["tech"] },
];

/** Which feed tags + relevance keywords fit this account's trade. */
export function tradeProfile(trade: string | null | undefined): {
  feedTags: string[];
  keywords: string[];
} {
  const t = (trade ?? "").toLowerCase();
  const base = ["construction", "housing", "vat", "revenue", "insurance", "fuel", "energy", "apprentice", "sme", "planning"];
  const match = (...words: string[]) => words.some((w) => t.includes(w));
  if (match("plumb", "heat", "gas"))
    return { feedTags: ["business", "construction"], keywords: [...base, "plumb", "heating", "boiler", "gas", "water", "retrofit"] };
  if (match("electr", "solar"))
    return { feedTags: ["business", "construction", "tech"], keywords: [...base, "electric", "solar", "ev ", "grid", "retrofit"] };
  if (match("build", "construct", "ground", "block", "brick"))
    return { feedTags: ["business", "construction"], keywords: [...base, "build", "site", "cement", "contract"] };
  if (match("carpen", "join", "wood", "kitchen"))
    return { feedTags: ["business", "construction"], keywords: [...base, "timber", "carpentry", "joinery", "wood"] };
  if (match("roof"))
    return { feedTags: ["business", "construction"], keywords: [...base, "roof"] };
  if (match("paint", "decor"))
    return { feedTags: ["business", "construction"], keywords: [...base, "paint", "decorat"] };
  if (match("landscap", "garden"))
    return { feedTags: ["business", "construction"], keywords: [...base, "landscap", "garden", "horticult"] };
  if (match("mechanic", "motor", "garage"))
    return { feedTags: ["business", "tech"], keywords: [...base, "motor", "car ", "garage", "ev ", "nct"] };
  // Unknown/unset trade: everything general + construction (the core market).
  return { feedTags: ["business", "construction"], keywords: base };
}

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#0?39;|&apos;|&#8217;/g, "'")
    .replace(/&quot;|&#8220;|&#8221;/g, '"')
    .replace(/&#8211;|&#8212;/g, "–")
    .replace(/&nbsp;/g, " ")
    .replace(/<[^>]+>/g, "")
    .trim();

const tag = (block: string, name: string): string => {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(block);
  return m ? decode(m[1]) : "";
};

/** Minimal RSS 2.0 / Atom parser — titles, links and dates only. */
export function parseFeed(xml: string, source: string): NewsItem[] {
  const items: NewsItem[] = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  for (const block of blocks.slice(0, 20)) {
    const title = tag(block, "title");
    // RSS <link>url</link>; Atom <link href="url"/>.
    let link = tag(block, "link");
    if (!link) {
      const href = /<link[^>]*href="([^"]+)"/i.exec(block);
      link = href ? decode(href[1]) : "";
    }
    const dateRaw = tag(block, "pubDate") || tag(block, "updated") || tag(block, "published") || tag(block, "dc:date");
    const parsedDate = dateRaw ? new Date(dateRaw) : null;
    const publishedAt = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : null;
    if (title && /^https?:\/\//i.test(link)) {
      items.push({ title, link, source, publishedAt });
    }
  }
  return items;
}

/**
 * Fetch every feed matching the tags, tolerate failures, merge newest-first,
 * dedupe near-identical headlines. Cached 30 minutes per feed via Next's
 * fetch cache, so a busy account costs the publishers almost nothing.
 */
export async function getNews(feedTags: string[]): Promise<{
  items: NewsItem[];
  sourcesUp: string[];
  sourcesDown: string[];
}> {
  const feeds = FEEDS.filter((f) => f.tags.some((t) => feedTags.includes(t)));
  const results = await Promise.allSettled(
    feeds.map(async (f) => {
      const res = await fetch(f.url, {
        signal: AbortSignal.timeout(6000),
        next: { revalidate: 1800 },
        headers: { "user-agent": "AutomateIQFinance/1.0 (+https://automateiq.ie)" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { feed: f, items: parseFeed(await res.text(), f.name) };
    })
  );

  const items: NewsItem[] = [];
  const sourcesUp: string[] = [];
  const sourcesDown: string[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value.items.length > 0) {
      sourcesUp.push(feeds[i].name);
      items.push(...r.value.items);
    } else {
      sourcesDown.push(feeds[i].name);
    }
  });

  const seen = new Set<string>();
  const deduped = items.filter((it) => {
    const key = it.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 80);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  deduped.sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
  return { items: deduped, sourcesUp, sourcesDown };
}

/** Split into "for your industry" vs general, by keyword match on the title. */
export function splitByRelevance(
  items: NewsItem[],
  keywords: string[]
): { industry: NewsItem[]; general: NewsItem[] } {
  const kws = keywords.map((k) => k.toLowerCase());
  const industry: NewsItem[] = [];
  const general: NewsItem[] = [];
  for (const it of items) {
    const t = ` ${it.title.toLowerCase()} `;
    (kws.some((k) => t.includes(k)) ? industry : general).push(it);
  }
  return { industry, general };
}
