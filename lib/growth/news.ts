import "server-only";

/**
 * The LinkedIn story feed.
 *
 * Pulls AI / automation / Irish-business news from public RSS and Atom feeds,
 * scores each story for how usable it is as a post for AutomateIQ, and hands
 * back the best ones with their links. No API key and no per-call cost, so it
 * can run as often as it likes — a paid news API would put a meter on the one
 * thing that should be frictionless.
 *
 * Parsing is regex-based for the same reason as the SEO engine: real-world
 * feeds are full of malformed XML, mixed RSS/Atom shapes and stray CDATA, and
 * a strict parser throws on exactly the feeds you most want to read.
 */

export type Story = {
  id: string;
  title: string;
  link: string;
  source: string;
  summary: string;
  publishedAt: string | null;
  /** 0–100: how well this maps to what AutomateIQ actually sells. */
  score: number;
  /** Which of his systems this story is an argument for. */
  angles: string[];
};

/**
 * Feeds chosen for a specific reader: an Irish SME owner scrolling LinkedIn.
 * Deliberately mixes the big AI outlets (what everyone is talking about) with
 * Irish business press (what HIS market is talking about) — a post that ties a
 * global AI story to an Irish trade reader is the one that gets engagement.
 */
const FEEDS: { url: string; source: string; weight: number }[] = [
  { url: "https://www.rte.ie/feeds/rss/?index=/news/business/", source: "RTÉ Business", weight: 1.3 },
  { url: "https://www.irishtimes.com/arc/outboundfeeds/feed-irish-times/business/?outputType=xml", source: "Irish Times Business", weight: 1.3 },
  { url: "https://www.siliconrepublic.com/feed", source: "Silicon Republic", weight: 1.4 },
  { url: "https://techcrunch.com/category/artificial-intelligence/feed/", source: "TechCrunch AI", weight: 1.0 },
  { url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml", source: "The Verge AI", weight: 0.9 },
  { url: "https://feeds.arstechnica.com/arstechnica/technology-lab", source: "Ars Technica", weight: 0.8 },
];

/**
 * What each of his systems sounds like in a news headline. The story doesn't
 * have to mention the product — it has to describe the PROBLEM the product
 * solves, because that's the post: "here's a thing in the news, here's what it
 * means for a plumber in Dublin".
 */
/** Exported so the branding guard can assert no retired product name survives
 *  here — these angle labels end up in captions Jude posts under his own name. */
export const ANGLE_TERMS: { angle: string; terms: string[]; weight: number }[] = [
  { angle: "ReceptionIQ", terms: ["missed call", "call centre", "call center", "receptionist", "phone answering", "customer service", "chatbot", "virtual assistant"], weight: 3 },
  { angle: "VoiceIQ", terms: ["voice ai", "speech", "voice assistant", "voice agent", "conversational ai"], weight: 3 },
  { angle: "LeadIQ", terms: ["lead response", "response time", "speed to lead", "enquiries", "inquiries", "sales follow-up"], weight: 3 },
  { angle: "ReputationIQ", terms: ["review", "reputation", "google business", "star rating", "customer feedback"], weight: 2 },
  { angle: "QuoteIQ", terms: ["quote", "quoting", "estimate", "pricing tool"], weight: 2 },
  { angle: "FinanceIQ", terms: ["invoice", "late payment", "cash flow", "accounts payable", "bookkeeping", "e-invoicing"], weight: 3 },
  { angle: "WorkforceIQ", terms: ["rota", "scheduling", "workforce", "staff shortage", "recruitment", "labour shortage", "skills gap"], weight: 2 },
  { angle: "FleetIQ", terms: ["logistics", "delivery", "fleet", "route", "supply chain", "haulage"], weight: 2 },
  { angle: "SafetyIQ", terms: ["compliance", "regulation", "health and safety", "hse", "audit", "gdpr", "ai act"], weight: 3 },
  { angle: "SiteIQ", terms: ["website", "seo", "search", "google ranking", "web traffic"], weight: 2 },
  { angle: "BespokeIQ", terms: ["small business", "sme", "smes", "productivity", "automation", "adoption", "digital transformation"], weight: 2 },
];

/** The story has to be ABOUT this space at all. Nothing scores without one. */
const CORE_TERMS = [
  "ai", "artificial intelligence", "automation", "automate", "machine learning",
  "chatgpt", "openai", "anthropic", "claude", "gemini", "copilot", "llm",
  "robot", "algorithm", "digital", "software", "tech",
];

/** Kills the stories that look relevant and make terrible SME posts. */
const NEGATIVE_TERMS = [
  "share price", "stock", "nasdaq", "ipo", "earnings call", "quarterly results",
  "lawsuit", "sues", "acquisition talks", "funding round", "series a", "series b",
  "valuation", "crypto", "bitcoin", "nft",
];

/** Irish angle — his readers are Irish, and a local hook lands far harder. */
const LOCAL_TERMS = ["ireland", "irish", "dublin", "cork", "galway", "limerick", "eu ", "europe"];

/* ------------------------------------------------------------------ */
/* Feed parsing                                                        */
/* ------------------------------------------------------------------ */

const strip = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;|&rsquo;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();

function tag(block: string, name: string): string | null {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(block);
  return m ? strip(m[1]) : null;
}

/** Atom puts the URL in an attribute; RSS puts it in the element body. */
function linkOf(block: string): string | null {
  const rss = tag(block, "link");
  if (rss && /^https?:\/\//i.test(rss)) return rss;
  const atom = /<link\b[^>]*href=["']([^"']+)["'][^>]*>/i.exec(block);
  if (atom && /^https?:\/\//i.test(atom[1])) return atom[1];
  const guid = tag(block, "guid");
  return guid && /^https?:\/\//i.test(guid) ? guid : null;
}

/** Both feed dialects, from one parser — <item> is RSS, <entry> is Atom. */
export function parseFeed(xml: string, source: string): Omit<Story, "score" | "angles">[] {
  const blocks = xml.match(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi) ?? [];
  const out: Omit<Story, "score" | "angles">[] = [];
  for (const b of blocks.slice(0, 40)) {
    const title = tag(b, "title");
    const link = linkOf(b);
    if (!title || !link) continue;
    const summary =
      tag(b, "description") ?? tag(b, "summary") ?? tag(b, "content") ?? "";
    const published =
      tag(b, "pubDate") ?? tag(b, "published") ?? tag(b, "updated") ?? null;
    let iso: string | null = null;
    if (published) {
      const d = new Date(published);
      if (!Number.isNaN(d.getTime())) iso = d.toISOString();
    }
    out.push({
      id: link,
      title: title.slice(0, 300),
      link,
      source,
      summary: summary.slice(0, 700),
      publishedAt: iso,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Relevance                                                           */
/* ------------------------------------------------------------------ */

const has = (hay: string, needle: string) => hay.includes(needle);

/**
 * Scores a story for "could I build a LinkedIn post for a trades/SME audience
 * out of this?" — NOT for how important the story is. A huge AI funding round
 * is major news and a terrible post for a plumber.
 */
export function scoreStory(
  s: Omit<Story, "score" | "angles">,
  feedWeight = 1
): { score: number; angles: string[] } {
  const text = `${s.title} ${s.summary}`.toLowerCase();

  const coreHits = CORE_TERMS.filter((t) => has(text, t)).length;
  if (coreHits === 0) return { score: 0, angles: [] };

  const angles: string[] = [];
  let angleScore = 0;
  for (const a of ANGLE_TERMS) {
    if (a.terms.some((t) => has(text, t))) {
      angles.push(a.angle);
      angleScore += a.weight;
    }
  }
  // A story with no angle is AI news with nothing to say to his market.
  if (angles.length === 0) return { score: 0, angles: [] };

  let score = Math.min(30, coreHits * 6) + Math.min(35, angleScore * 5);
  if (LOCAL_TERMS.some((t) => has(text, t))) score += 15;
  // The headline carrying the angle beats it being buried in paragraph four.
  if (ANGLE_TERMS.some((a) => a.terms.some((t) => has(s.title.toLowerCase(), t)))) score += 10;
  for (const n of NEGATIVE_TERMS) if (has(text, n)) score -= 12;

  // Freshness: LinkedIn rewards reacting fast, and a two-week-old story reads
  // as someone who isn't paying attention.
  if (s.publishedAt) {
    const days = (Date.now() - Date.parse(s.publishedAt)) / 86_400_000;
    if (days <= 2) score += 12;
    else if (days <= 5) score += 6;
    else if (days > 14) score -= 20;
  }

  return { score: Math.max(0, Math.min(100, Math.round(score * feedWeight))), angles };
}

/* ------------------------------------------------------------------ */
/* Fetching                                                            */
/* ------------------------------------------------------------------ */

async function fetchFeed(url: string, timeoutMs: number): Promise<string | null> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; AutomateIQ/1.0; +https://automateiq.ie)",
        accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
      },
      // Feeds update hourly at most; caching keeps the page instant and is
      // polite to the publishers.
      next: { revalidate: 1800 },
    });
    if (!res.ok) return null;
    return (await res.text()).slice(0, 600_000);
  } catch {
    return null;
  }
}

export type NewsResult = {
  stories: Story[];
  /** Feeds that didn't answer — shown honestly rather than silently dropped. */
  failed: string[];
};

/**
 * Every feed in parallel, best stories first. A dead feed never takes the page
 * down — it's named in `failed` and the rest still render.
 */
export async function loadStories(limit = 12): Promise<NewsResult> {
  const results = await Promise.all(
    FEEDS.map(async (f) => ({ feed: f, xml: await fetchFeed(f.url, 8000) }))
  );

  const seenTitle = new Set<string>();
  const all: Story[] = [];
  const failed: string[] = [];

  for (const { feed, xml } of results) {
    if (!xml) {
      failed.push(feed.source);
      continue;
    }
    for (const raw of parseFeed(xml, feed.source)) {
      // Same story syndicated across outlets — keep the first (best-weighted
      // feed runs earlier in the list).
      const key = raw.title.toLowerCase().replace(/[^a-z0-9 ]/g, "").slice(0, 60);
      if (seenTitle.has(key)) continue;
      const { score, angles } = scoreStory(raw, feed.weight);
      if (score <= 0) continue;
      seenTitle.add(key);
      all.push({ ...raw, score, angles });
    }
  }

  all.sort((a, b) => b.score - a.score);
  return { stories: all.slice(0, limit), failed };
}
