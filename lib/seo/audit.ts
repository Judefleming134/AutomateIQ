import "server-only";
import { isPublicWebHost } from "@/lib/growth/research";

/**
 * The AutoSEO engine behind automateiq.ie/freetools/autoseo.
 *
 * Reads a business website the way a search engine does and reports what's
 * missing, in words a plumber can act on. Everything here is derived from the
 * page's own HTML plus robots.txt and sitemap.xml — no paid APIs, no rate-
 * limited third party, so a run costs nothing and can stay genuinely free.
 *
 * Deliberately regex-based rather than a DOM parser: the same approach the
 * research engine already uses, it survives the malformed markup SME sites are
 * full of (a real parser throws or "corrects" the very errors we're looking
 * for), and it adds no dependency. Every pattern is written to fail closed —
 * a match we can't make becomes "couldn't detect", never a false pass.
 */

export type CheckStatus = "pass" | "warn" | "fail";
export type CheckImpact = "high" | "medium" | "low";

export type SeoCheck = {
  id: string;
  label: string;
  status: CheckStatus;
  impact: CheckImpact;
  /** What's actually on the page right now. */
  found: string;
  /** Why a business owner should care — never SEO jargon. */
  why: string;
  /** What to do about it. */
  fix: string;
  /** Ready-to-paste markup, where a concrete snippet exists. */
  snippet?: string;
};

/** Raw observations, kept separate from the checks so the fix writer can use them. */
export type SiteFacts = {
  title: string | null;
  metaDescription: string | null;
  h1s: string[];
  h2s: string[];
  lang: string | null;
  canonical: string | null;
  viewport: string | null;
  favicon: boolean;
  og: { title: boolean; description: boolean; image: boolean };
  twitterCard: boolean;
  jsonLdTypes: string[];
  images: { total: number; missingAlt: number; sampleMissing: string[] };
  wordCount: number;
  internalLinks: number;
  externalLinks: number;
  phones: string[];
  emails: string[];
  addressHint: string | null;
  mapEmbed: boolean;
  scriptCount: number;
  htmlBytes: number;
  loadMs: number;
  https: boolean;
  redirectedTo: string | null;
  robotsTxt: { exists: boolean; blocksAll: boolean; sitemapListed: boolean };
  sitemap: { exists: boolean; urlCount: number };
  /** Best guess at the trading name, for the generated fixes. */
  businessName: string | null;
};

export type SeoAudit = {
  url: string;
  finalUrl: string;
  host: string;
  fetchedAt: string;
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  /** One plain sentence a business owner can repeat to whoever built the site. */
  verdict: string;
  counts: { pass: number; warn: number; fail: number };
  /** Failures that make everything else moot — the site is invisible to Google
   *  regardless of how good the rest is. Drives the red banner on the report. */
  blockers: { id: string; label: string }[];
  checks: SeoCheck[];
  facts: SiteFacts;
};

export type AuditFailure = {
  error:
    | "invalid_url"
    | "blocked_host"
    | "unreachable"
    | "not_html"
    | "empty";
  message: string;
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/** Whole-audit budget. Three fetches, generous but bounded well inside the 60s
 *  serverless limit so a slow site can never take the request down with it. */
const TOTAL_BUDGET_MS = 20_000;
const PAGE_TIMEOUT_MS = 12_000;
const SIDE_TIMEOUT_MS = 5_000;

/* ------------------------------------------------------------------ */
/* Small HTML helpers                                                  */
/* ------------------------------------------------------------------ */

const decode = (s: string) =>
  s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();

/** Strips tags for word counting and text searches. */
function visibleText(html: string): string {
  return decode(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " ")
  );
}

/** Reads an attribute off a single tag string, quoted or bare. */
function attr(tag: string, name: string): string | null {
  const quoted = new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag);
  if (quoted) return decode(quoted[1]);
  const bare = new RegExp(`${name}\\s*=\\s*([^\\s>]+)`, "i").exec(tag);
  return bare ? decode(bare[1]) : null;
}

/** All <meta> tags whose `name` OR `property` matches — both spellings are used. */
function metaContent(html: string, key: string): string | null {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const which = attr(tag, "name") ?? attr(tag, "property");
    if (which && which.toLowerCase() === key.toLowerCase()) {
      const content = attr(tag, "content");
      if (content) return content;
    }
  }
  return null;
}

function headings(html: string, level: 1 | 2): string[] {
  const re = new RegExp(`<h${level}\\b[^>]*>([\\s\\S]*?)</h${level}>`, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const text = visibleText(m[1]);
    if (text) out.push(text.slice(0, 200));
    if (out.length >= 30) break;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Fetching                                                            */
/* ------------------------------------------------------------------ */

type PageFetch = {
  html: string;
  finalUrl: string;
  loadMs: number;
  bytes: number;
};

async function fetchPage(target: string, timeoutMs: number): Promise<PageFetch | null> {
  const started = Date.now();
  const res = await fetch(target, {
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      "user-agent": UA,
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-IE,en-GB;q=0.9,en;q=0.8",
    },
  });
  if (!res.ok) return null;
  const type = res.headers.get("content-type") ?? "";
  if (type && !type.includes("html") && !type.includes("text")) return null;
  // Cap the read: a runaway page shouldn't be able to exhaust memory, and no
  // SEO signal we care about lives past the first megabyte.
  const html = (await res.text()).slice(0, 1_000_000);
  return {
    html,
    finalUrl: res.url || target,
    loadMs: Date.now() - started,
    bytes: html.length,
  };
}

/** robots.txt and sitemap.xml — both optional, both fail quietly. */
async function fetchText(target: string, timeoutMs: number): Promise<string | null> {
  try {
    const res = await fetch(target, {
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "user-agent": UA },
    });
    if (!res.ok) return null;
    return (await res.text()).slice(0, 200_000);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Fact extraction                                                     */
/* ------------------------------------------------------------------ */

function extractFacts(
  page: PageFetch,
  origin: string,
  host: string,
  robotsRaw: string | null,
  sitemapRaw: string | null
): SiteFacts {
  const { html } = page;
  const head = html.slice(0, 200_000);

  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head);
  const title = titleMatch ? visibleText(titleMatch[1]) || null : null;

  const h1s = headings(html, 1);
  const h2s = headings(html, 2);

  // Images: count every <img>, flag those with no alt attribute at all or an
  // empty one. A decorative image legitimately has alt="", so this is reported
  // as a proportion and never as a hard failure on its own.
  const imgTags = html.match(/<img\b[^>]*>/gi) ?? [];
  const missing: string[] = [];
  for (const tag of imgTags) {
    const alt = attr(tag, "alt");
    if (alt === null || alt.trim() === "") {
      const src = attr(tag, "src") ?? attr(tag, "data-src") ?? "";
      const name = src.split("/").pop()?.split("?")[0] ?? "";
      if (name && missing.length < 12) missing.push(name.slice(0, 80));
    }
  }
  const missingAlt = imgTags.filter((t) => {
    const alt = attr(t, "alt");
    return alt === null || alt.trim() === "";
  }).length;

  // Structured data: collect the @type values out of every JSON-LD block. Some
  // sites nest them in @graph, so scan the raw text rather than parsing —
  // a single malformed block shouldn't hide the valid ones next to it.
  const jsonLdTypes = new Set<string>();
  const ldRe = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let ld: RegExpExecArray | null;
  while ((ld = ldRe.exec(html))) {
    for (const t of ld[1].match(/"@type"\s*:\s*"([^"]+)"/g) ?? []) {
      const value = /"@type"\s*:\s*"([^"]+)"/.exec(t)?.[1];
      if (value) jsonLdTypes.add(value);
    }
  }

  const text = visibleText(html);
  const wordCount = text ? text.split(/\s+/).filter(Boolean).length : 0;

  // Links, split into internal and external. Anchors, mailto and tel don't count.
  let internal = 0;
  let external = 0;
  for (const a of html.match(/<a\b[^>]*href\s*=\s*["'][^"']+["'][^>]*>/gi) ?? []) {
    const href = attr(a, "href") ?? "";
    if (!href || href.startsWith("#") || /^(mailto|tel|javascript):/i.test(href)) continue;
    if (/^https?:\/\//i.test(href)) {
      try {
        const sameSite =
          new URL(href).hostname.replace(/^www\./, "") === host.replace(/^www\./, "");
        if (sameSite) internal++;
        else external++;
      } catch {
        external++;
      }
    } else internal++;
  }

  // Contact details — the local-SEO signals. Irish numbers appear in a dozen
  // shapes, so match generously and de-duplicate on digits.
  const phones = new Set<string>();
  for (const m of html.match(/href=["']tel:([^"']+)["']/gi) ?? []) {
    const num = /tel:([^"']+)/i.exec(m)?.[1];
    if (num) phones.add(num.trim().slice(0, 32));
  }
  if (phones.size === 0) {
    for (const m of text.match(/(?:\+353|0)\s?\d{1,2}[\s-]?\d{3}[\s-]?\d{3,4}/g) ?? []) {
      phones.add(m.trim());
      if (phones.size >= 3) break;
    }
  }
  const emails = new Set<string>();
  for (const m of html.match(/href=["']mailto:([^"'?]+)/gi) ?? []) {
    const addr = /mailto:([^"'?]+)/i.exec(m)?.[1];
    if (addr) emails.add(addr.trim().toLowerCase().slice(0, 120));
  }

  // Address: an Eircode is the strongest possible signal on an Irish site.
  // Failing that, look for a county or city name near a street-ish line.
  const eircode = /\b[AC-FHKNPRTV-Y]\d{2}\s?[0-9AC-FHKNPRTV-Y]{4}\b/i.exec(text)?.[0] ?? null;
  const county =
    /\b(?:Co\.?|County)\s+[A-Z][a-z]+|\b(?:Dublin|Cork|Galway|Limerick|Waterford|Kilkenny|Wexford|Sligo|Donegal|Kerry|Mayo|Meath|Kildare|Wicklow|Louth|Clare|Tipperary)\b/.exec(
      text
    )?.[0] ?? null;
  const addressHint = eircode ? `${county ? `${county}, ` : ""}${eircode}` : county;

  const robotsTxt = {
    exists: robotsRaw !== null,
    // "Disallow: /" under a wildcard agent hides the whole site from Google.
    blocksAll: robotsRaw
      ? /user-agent:\s*\*[\s\S]*?disallow:\s*\/\s*(?:\n|$)/i.test(robotsRaw)
      : false,
    sitemapListed: robotsRaw ? /^\s*sitemap:/im.test(robotsRaw) : false,
  };

  const sitemap = {
    exists: sitemapRaw !== null && /<(?:urlset|sitemapindex)\b/i.test(sitemapRaw),
    urlCount: sitemapRaw ? (sitemapRaw.match(/<loc>/gi) ?? []).length : 0,
  };

  // Trading name: the part of the title before a separator is right far more
  // often than not ("Murphy Plumbing | Emergency Plumber Dublin").
  const businessName =
    title?.split(/\s[|\-–—·]\s/)[0]?.trim().slice(0, 80) ||
    host.replace(/^www\./, "").split(".")[0] ||
    null;

  return {
    title,
    metaDescription: metaContent(head, "description"),
    h1s,
    h2s,
    lang: attr(/<html\b[^>]*>/i.exec(head)?.[0] ?? "", "lang"),
    canonical: (() => {
      for (const tag of head.match(/<link\b[^>]*>/gi) ?? []) {
        if ((attr(tag, "rel") ?? "").toLowerCase() === "canonical") return attr(tag, "href");
      }
      return null;
    })(),
    viewport: metaContent(head, "viewport"),
    favicon: (head.match(/<link\b[^>]*>/gi) ?? []).some((t) =>
      /icon/i.test(attr(t, "rel") ?? "")
    ),
    og: {
      title: !!metaContent(head, "og:title"),
      description: !!metaContent(head, "og:description"),
      image: !!metaContent(head, "og:image"),
    },
    twitterCard: !!metaContent(head, "twitter:card"),
    jsonLdTypes: [...jsonLdTypes],
    images: { total: imgTags.length, missingAlt, sampleMissing: missing },
    wordCount,
    internalLinks: internal,
    externalLinks: external,
    phones: [...phones],
    emails: [...emails],
    addressHint,
    mapEmbed: /google\.com\/maps\/embed|maps\.google\.[a-z.]+\/maps\?/i.test(html),
    scriptCount: (html.match(/<script\b/gi) ?? []).length,
    htmlBytes: page.bytes,
    loadMs: page.loadMs,
    https: origin.startsWith("https:"),
    redirectedTo: null,
    robotsTxt,
    sitemap,
    businessName,
  };
}

/* ------------------------------------------------------------------ */
/* The checks                                                          */
/* ------------------------------------------------------------------ */

function buildChecks(f: SiteFacts, host: string): SeoCheck[] {
  const checks: SeoCheck[] = [];
  const add = (c: SeoCheck) => checks.push(c);
  const clean = host.replace(/^www\./, "");

  /* --- The page title: the single biggest on-page factor there is. ------ */
  const titleLen = f.title?.length ?? 0;
  add({
    id: "title",
    label: "Page title",
    impact: "high",
    status: !f.title ? "fail" : titleLen < 30 || titleLen > 65 ? "warn" : "pass",
    found: f.title ? `"${f.title}" (${titleLen} characters)` : "No title tag at all",
    why: "This is the blue clickable line in Google results. If it's missing, Google invents one from your page — usually badly. If it doesn't say what you do and where, nobody searching for your service will click it.",
    fix: !f.title
      ? "Add a title tag naming your service and your town."
      : titleLen > 65
        ? `Shorten it to under 60 characters — Google cuts it off at about there, so the end of yours is currently invisible in results.`
        : titleLen < 30
          ? "Too short to work hard. Add the service and the location people actually search for."
          : "Good length and shape — nothing to do here.",
    snippet:
      !f.title || titleLen < 30 || titleLen > 65
        ? `<title>${f.businessName ?? "Your Business"} | [Your Main Service] in [Your Town]</title>`
        : undefined,
  });

  /* --- Meta description: doesn't rank you, but it's your ad copy. ------- */
  const descLen = f.metaDescription?.length ?? 0;
  add({
    id: "meta_description",
    label: "Search result description",
    impact: "high",
    status: !f.metaDescription ? "fail" : descLen < 70 || descLen > 165 ? "warn" : "pass",
    found: f.metaDescription
      ? `"${f.metaDescription.slice(0, 120)}${descLen > 120 ? "…" : ""}" (${descLen} characters)`
      : "No description — Google is picking a random sentence off your page",
    why: "The grey text under your link in Google. It doesn't change your ranking, but it's the two lines that decide whether someone clicks you or the competitor below you. Leaving it blank means Google grabs whatever text it finds first.",
    fix: !f.metaDescription
      ? "Write 150 characters that say what you do, where, and why to call you. Finish with a reason to act."
      : descLen > 165
        ? "Trim to 155 characters — the rest is cut off with an ellipsis."
        : descLen < 70
          ? "Use the space. You've got 155 characters and you're using far fewer."
          : "Good length — reads as intended in results.",
    snippet:
      !f.metaDescription || descLen < 70 || descLen > 165
        ? `<meta name="description" content="[What you do] in [your town]. [Why people choose you — years, guarantee, call-out time]. Call ${f.phones[0] ?? "[your number]"} for a free quote." />`
        : undefined,
  });

  /* --- Headings ---------------------------------------------------------- */
  add({
    id: "h1",
    label: "Main heading (H1)",
    impact: "high",
    status: f.h1s.length === 0 ? "fail" : f.h1s.length > 1 ? "warn" : "pass",
    found:
      f.h1s.length === 0
        ? "No H1 on the page"
        : f.h1s.length === 1
          ? `One H1: "${f.h1s[0].slice(0, 90)}"`
          : `${f.h1s.length} H1 headings — should be one`,
    why: "The H1 is the headline of the page. Google uses it to work out what the page is about. Sites built in page-builders often style text to look big without ever making it a real heading, which leaves the page with none.",
    fix:
      f.h1s.length === 0
        ? "Give the homepage one H1 that names your service and town."
        : f.h1s.length > 1
          ? "Keep the most important one as H1 and demote the rest to H2."
          : "Exactly right — one clear H1.",
    snippet:
      f.h1s.length === 0
        ? `<h1>[Your Main Service] in [Your Town] — ${f.businessName ?? "Your Business"}</h1>`
        : undefined,
  });

  add({
    id: "h2",
    label: "Sub-headings (H2)",
    impact: "low",
    status: f.h2s.length === 0 ? "warn" : "pass",
    found: f.h2s.length === 0 ? "No H2 headings" : `${f.h2s.length} sub-headings`,
    why: "Sub-headings break the page into sections Google can read as separate topics — services, areas covered, prices. A wall of unbroken text is much harder for it to make sense of.",
    fix:
      f.h2s.length === 0
        ? "Break the page into sections with H2s: your services, areas you cover, why choose you, contact."
        : "Page has a readable structure.",
  });

  /* --- Local SEO: schema + NAP. The two that actually move Irish SMEs. --- */
  const hasLocal = f.jsonLdTypes.some((t) =>
    /LocalBusiness|Organization|Store|Restaurant|Plumber|Electrician|HomeAndConstruction|ProfessionalService|Dentist|Physician|LegalService|AutoRepair/i.test(
      t
    )
  );
  add({
    id: "schema_local",
    label: "Business details Google can read (schema)",
    impact: "high",
    status: hasLocal ? "pass" : "fail",
    found: f.jsonLdTypes.length
      ? `Structured data found (${f.jsonLdTypes.slice(0, 5).join(", ")}) but no business/LocalBusiness type`
      : "None — Google has to guess your name, address, hours and phone number",
    why: "This is a hidden block of code that hands Google your business name, address, phone, opening hours and reviews in a format it trusts completely. It's what powers the map pack and the rich business panel on the right of the results. Most small Irish sites don't have it, which is exactly why it's such an easy win.",
    fix: "Paste the block below into the <head> of every page, with your real details filled in.",
    snippet: hasLocal
      ? undefined
      : localBusinessSnippet(f, clean),
  });

  const napParts = [
    f.businessName ? null : "business name",
    f.phones.length ? null : "phone number",
    f.addressHint ? null : "address",
  ].filter(Boolean) as string[];
  add({
    id: "nap",
    label: "Name, address and phone on the page",
    impact: "high",
    status: napParts.length === 0 ? "pass" : napParts.length >= 2 ? "fail" : "warn",
    found:
      napParts.length === 0
        ? `Name, phone (${f.phones[0]}) and address all present`
        : `Missing from the page: ${napParts.join(", ")}`,
    why: "Google cross-checks the name, address and phone on your site against your Google Business Profile and every directory that lists you. When they match, you rank locally. When the address isn't on the site at all, it can't make the match — and 'near me' searches skip you.",
    fix:
      napParts.length === 0
        ? "All three present — make sure they match your Google Business Profile exactly, character for character."
        : `Put your ${napParts.join(", ")} in the footer of every page, in plain text (not inside an image).`,
  });

  add({
    id: "phone_link",
    label: "Tap-to-call number",
    impact: "medium",
    status: f.phones.length ? "pass" : "warn",
    found: f.phones.length ? `Number found: ${f.phones[0]}` : "No phone number detected",
    why: "Over half your visitors are on a phone. If the number isn't a tappable link they have to memorise it, close your site and open the dialler — most just don't.",
    fix: f.phones.length
      ? "Number present. Check it's a tel: link, not plain text."
      : "Add your number as a tap-to-call link in the header.",
    snippet: f.phones.length
      ? undefined
      : `<a href="tel:+353XXXXXXXXX">Call us: 0XX XXX XXXX</a>`,
  });

  /* --- Mobile + technical basics ---------------------------------------- */
  add({
    id: "viewport",
    label: "Mobile-friendly setting",
    impact: "high",
    status: f.viewport ? "pass" : "fail",
    found: f.viewport ? `Set: ${f.viewport}` : "Missing — the site will render desktop-sized on phones",
    why: "Without this one line, phones show a shrunken desktop layout that people have to pinch and zoom. Google indexes the mobile version of your site first, so it judges you on that experience.",
    fix: f.viewport ? "Correctly set." : "Add the viewport meta tag to the <head>.",
    snippet: f.viewport
      ? undefined
      : `<meta name="viewport" content="width=device-width, initial-scale=1" />`,
  });

  add({
    id: "https",
    label: "Secure connection (HTTPS)",
    impact: "high",
    status: f.https ? "pass" : "fail",
    found: f.https ? "Served over HTTPS" : "Not secure — browsers show a 'Not secure' warning",
    why: "Chrome puts a 'Not secure' warning in the address bar of any site without it. People bounce, and Google has used it as a ranking signal for years. Certificates are free.",
    fix: f.https
      ? "Secure."
      : "Ask your host to enable a free Let's Encrypt certificate, then redirect all http traffic to https.",
  });

  add({
    id: "canonical",
    label: "Duplicate-page protection (canonical)",
    impact: "medium",
    status: f.canonical ? "pass" : "warn",
    found: f.canonical ? `Set to ${f.canonical}` : "Not set",
    why: "Your homepage is usually reachable at four addresses at once — with and without www, with and without a trailing slash. Google can treat those as four competing copies and split your ranking between them. A canonical tag names the one that counts.",
    fix: f.canonical ? "Set correctly." : "Add a canonical tag to each page pointing at its preferred address.",
    snippet: f.canonical ? undefined : `<link rel="canonical" href="https://${clean}/" />`,
  });

  add({
    id: "lang",
    label: "Page language",
    impact: "low",
    status: f.lang ? "pass" : "warn",
    found: f.lang ? `Declared as "${f.lang}"` : "Not declared",
    why: "Tells search engines and screen readers what language the page is in. A small thing, but it costs one attribute.",
    fix: f.lang ? "Declared." : "Set it on the <html> tag.",
    snippet: f.lang ? undefined : `<html lang="en-IE">`,
  });

  /* --- Images ------------------------------------------------------------ */
  const altPct =
    f.images.total === 0
      ? 100
      : Math.round(((f.images.total - f.images.missingAlt) / f.images.total) * 100);
  add({
    id: "image_alt",
    label: "Image descriptions (alt text)",
    impact: "medium",
    status:
      f.images.total === 0 ? "warn" : altPct >= 90 ? "pass" : altPct >= 50 ? "warn" : "fail",
    found:
      f.images.total === 0
        ? "No images found on the page"
        : `${f.images.missingAlt} of ${f.images.total} images have no description (${altPct}% done)`,
    why: "Alt text is what Google reads instead of the picture, and what a blind visitor's screen reader speaks aloud. Your photos of finished jobs are a ranking asset you're currently getting nothing for — and under the EU Accessibility Act it's a legal consideration, not just an SEO one.",
    fix:
      f.images.total === 0
        ? "Add real photos of your work — they build trust faster than any amount of copy."
        : f.images.missingAlt === 0
          ? "All images described."
          : `Describe each image in plain words${f.images.sampleMissing.length ? ` — starting with ${f.images.sampleMissing.slice(0, 3).join(", ")}` : ""}.`,
    snippet: f.images.missingAlt
      ? `<img src="..." alt="New gas boiler installed in a Dublin 15 semi-detached home" />`
      : undefined,
  });

  /* --- Content ----------------------------------------------------------- */
  add({
    id: "content",
    label: "Amount of content",
    impact: "medium",
    status: f.wordCount < 150 ? "fail" : f.wordCount < 350 ? "warn" : "pass",
    found: `About ${f.wordCount} words on the homepage`,
    why: "Google can only rank you for words that appear on your site. A homepage that's mostly a photo and a phone number gives it almost nothing to match against a search. 400–600 words covering your services and areas is the realistic floor.",
    fix:
      f.wordCount < 350
        ? "Add sections for each service, the areas you cover, and answers to the questions you get asked on every call."
        : "Enough for Google to work with.",
  });

  // A React/Vue/Wix site can serve an almost-empty shell and paint the real
  // page in the browser afterwards. Every technical check above passes, the
  // site looks perfect to a human — and Google's crawler frequently indexes
  // the blank shell. Worth catching precisely because nothing else here would.
  const jsRendered = f.wordCount < 120 && f.scriptCount >= 3;
  add({
    id: "js_rendered",
    label: "Content visible without JavaScript",
    impact: "high",
    status: jsRendered ? "fail" : "pass",
    found: jsRendered
      ? `Only ${f.wordCount} words in the page source, with ${f.scriptCount} scripts — the content is being drawn by JavaScript after the page loads`
      : `${f.wordCount} words readable directly in the page source`,
    why: "Your site looks fine to you because your browser runs the JavaScript that builds it. Google's crawler often doesn't wait for that, so it can index a blank page. This is the single most common reason a good-looking modern site ranks for nothing at all.",
    fix: jsRendered
      ? "Ask whoever built the site to enable server-side rendering or pre-rendering, so the text is in the HTML before any JavaScript runs. Then check it with Google Search Console's URL Inspection tool — 'View crawled page' shows you exactly what Google sees."
      : "Your text is in the page source where crawlers can read it.",
  });

  add({
    id: "internal_links",
    label: "Links between your pages",
    impact: "low",
    status: f.internalLinks >= 5 ? "pass" : f.internalLinks >= 2 ? "warn" : "fail",
    found: `${f.internalLinks} internal link${f.internalLinks === 1 ? "" : "s"}`,
    why: "Google finds your other pages by following links from this one. A homepage with barely any links leaves the rest of the site effectively invisible.",
    fix:
      f.internalLinks >= 5
        ? "Well linked."
        : "Link from the homepage to every service page and your contact page.",
  });

  /* --- Crawlability ------------------------------------------------------ */
  add({
    id: "robots",
    label: "robots.txt",
    impact: f.robotsTxt.blocksAll ? "high" : "low",
    status: f.robotsTxt.blocksAll ? "fail" : f.robotsTxt.exists ? "pass" : "warn",
    found: f.robotsTxt.blocksAll
      ? "Present and BLOCKING the entire site from search engines"
      : f.robotsTxt.exists
        ? "Present and allowing crawlers"
        : "No robots.txt (harmless, but it's where your sitemap should be listed)",
    why: f.robotsTxt.blocksAll
      ? "This file is currently telling Google not to index a single page of your site. It's usually left over from when the site was being built. Nothing else on this list matters until it's fixed."
      : "A small text file at the root of your site that tells search engines what they may read, and points them at your sitemap.",
    fix: f.robotsTxt.blocksAll
      ? "Remove the 'Disallow: /' line immediately, then request re-indexing in Google Search Console."
      : f.robotsTxt.exists
        ? "Fine as it is."
        : "Add one at /robots.txt.",
    snippet: f.robotsTxt.exists
      ? undefined
      : `User-agent: *\nAllow: /\n\nSitemap: https://${clean}/sitemap.xml`,
  });

  add({
    id: "sitemap",
    label: "Sitemap",
    impact: "medium",
    status: f.sitemap.exists ? "pass" : "warn",
    found: f.sitemap.exists
      ? `Found, listing ${f.sitemap.urlCount} page${f.sitemap.urlCount === 1 ? "" : "s"}`
      : "No sitemap.xml found",
    why: "A list of every page on your site, handed straight to Google so it doesn't have to discover them by chance. On a small site it can be the difference between three pages indexed and thirty.",
    fix: f.sitemap.exists
      ? f.robotsTxt.sitemapListed
        ? "Present and listed in robots.txt."
        : "Present — also list it in robots.txt so crawlers find it immediately."
      : "Generate one (most site builders have a setting for it) and submit it in Google Search Console.",
  });

  /* --- Sharing ----------------------------------------------------------- */
  const ogCount = [f.og.title, f.og.description, f.og.image].filter(Boolean).length;
  add({
    id: "social_preview",
    label: "Link preview when shared",
    impact: "medium",
    status: ogCount === 3 ? "pass" : ogCount >= 1 ? "warn" : "fail",
    found:
      ogCount === 3
        ? "Full preview card set up"
        : ogCount === 0
          ? "None — your link shows as bare text in WhatsApp and Facebook"
          : `Partly set up (${ogCount} of 3 tags)`,
    why: "When someone shares your site in a WhatsApp group or a local Facebook page — which is how most trade work actually spreads — these tags decide whether it appears as a proper card with your logo and a headline, or as a naked grey URL nobody taps.",
    fix:
      ogCount === 3
        ? "Correctly set."
        : "Add the Open Graph tags below, pointing the image at a 1200×630 photo or your logo.",
    snippet:
      ogCount === 3
        ? undefined
        : `<meta property="og:title" content="${f.businessName ?? "Your Business"} | [Service] in [Town]" />\n<meta property="og:description" content="[One line about what you do and why to call you]" />\n<meta property="og:image" content="https://${clean}/share-image.jpg" />\n<meta property="og:url" content="https://${clean}/" />\n<meta property="og:type" content="website" />`,
  });

  add({
    id: "favicon",
    label: "Browser tab icon",
    impact: "low",
    status: f.favicon ? "pass" : "warn",
    found: f.favicon ? "Set" : "Missing — shows a blank page icon in tabs and bookmarks",
    why: "Small, but it's what people look for when your site is one of fifteen open tabs, and it's the icon that appears if they save you to their home screen.",
    fix: f.favicon ? "Set." : "Add a favicon — your logo cropped square works.",
  });

  /* --- Speed ------------------------------------------------------------- */
  const kb = Math.round(f.htmlBytes / 1024);
  add({
    id: "speed",
    label: "Page response speed",
    impact: "medium",
    status: f.loadMs < 1200 ? "pass" : f.loadMs < 3000 ? "warn" : "fail",
    found: `Server responded in ${(f.loadMs / 1000).toFixed(1)}s, page code is ${kb}KB`,
    why: "This is how fast your server sent the page — before any images loaded. Slow responses on a phone on 4G lose visitors before they see anything, and Google measures it directly.",
    fix:
      f.loadMs < 1200
        ? "Responding quickly."
        : f.loadMs < 3000
          ? "A bit slow. Caching or a better hosting plan usually fixes it."
          : "Slow enough to be losing you visitors. Worth moving host, or putting Cloudflare's free tier in front of it.",
  });

  return checks;
}

/** An Eircode is the one address fragment we can drop straight into the JSON-LD. */
const EIRCODE_RE = /\b[AC-FHKNPRTV-Y]\d{2}\s?[0-9AC-FHKNPRTV-Y]{4}\b/i;

/** The LocalBusiness block, pre-filled with whatever we could actually find. */
function localBusinessSnippet(f: SiteFacts, cleanHost: string): string {
  const eircode = EIRCODE_RE.exec(f.addressHint ?? "")?.[0] ?? "[Eircode]";
  return `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  "name": "${f.businessName ?? "Your Business Name"}",
  "url": "https://${cleanHost}/",
  "telephone": "${f.phones[0] ?? "+353 XX XXX XXXX"}",
  "email": "${f.emails[0] ?? "hello@" + cleanHost}",
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "[Street address]",
    "addressLocality": "[Town]",
    "addressRegion": "[County]",
    "postalCode": "${eircode}",
    "addressCountry": "IE"
  },
  "openingHoursSpecification": [{
    "@type": "OpeningHoursSpecification",
    "dayOfWeek": ["Monday","Tuesday","Wednesday","Thursday","Friday"],
    "opens": "08:00",
    "closes": "18:00"
  }],
  "areaServed": "[Towns and counties you cover]"
}
</script>`;
}

/* ------------------------------------------------------------------ */
/* Scoring                                                             */
/* ------------------------------------------------------------------ */

const WEIGHT: Record<CheckImpact, number> = { high: 10, medium: 5, low: 2 };
/** A warn is a partial credit — the thing exists but isn't pulling its weight. */
const CREDIT: Record<CheckStatus, number> = { pass: 1, warn: 0.5, fail: 0 };

function scoreOf(checks: SeoCheck[]): number {
  let earned = 0;
  let total = 0;
  for (const c of checks) {
    earned += WEIGHT[c.impact] * CREDIT[c.status];
    total += WEIGHT[c.impact];
  }
  return total === 0 ? 0 : Math.round((earned / total) * 100);
}

/**
 * Two failures mean the site is effectively invisible to Google no matter what
 * else is right: robots.txt banning every crawler, and content that only
 * exists after JavaScript runs. Without a cap, a site Google literally cannot
 * index scored 91/100 here purely on tidy meta tags — a number that would
 * destroy the report's credibility the moment someone checked it against
 * reality. A blocker holds the score down until it's fixed.
 */
const SHOWSTOPPER_IDS = new Set(["robots", "js_rendered"]);
const BLOCKED_CEILING = 35;

/**
 * Ranks findings so the report can lead with ONE thing. Showstoppers first,
 * then failures before warnings, then by impact, then by the order the checks
 * are declared in (which runs roughly most- to least-important already).
 * A report that opens with a list of nineteen is a report nobody acts on.
 */
function priority(check: SeoCheck, index: number): number {
  const blocker = SHOWSTOPPER_IDS.has(check.id) && check.status === "fail" ? 0 : 1;
  const byStatus = { fail: 0, warn: 1, pass: 2 }[check.status];
  const byImpact = { high: 0, medium: 1, low: 2 }[check.impact];
  return blocker * 1000 + byStatus * 100 + byImpact * 10 + index / 100;
}

/**
 * The headline sentence, in the owner's own words rather than an SEO's.
 *
 * Derived from the SAME check the report shows as finding #1, deliberately.
 * An earlier version ranked the verdict off its own separate precedence list,
 * so a site could be told "Google can't tell what your business does" while
 * the big card underneath was about the meta description — two answers to one
 * question, which is exactly how a free report loses trust.
 */
function verdictFor(top: SeoCheck | undefined, blocked: boolean, bigMisses: number): string {
  if (blocked) {
    return "Google can't read this site at all — everything else is beside the point until that's fixed.";
  }
  if (!top) {
    return "This site is in good shape — every check passed.";
  }
  // A warning is not a failure, and the headline shouldn't sound like one. A
  // site scoring 98 with one thin-content warning was being told "there isn't
  // enough on the page for Google to match against" — true of the check,
  // wildly overstated as a verdict on the site.
  if (top.status === "warn" && bigMisses === 0) {
    return `Nothing on this site is broken — the best remaining win is the ${top.label.toLowerCase()}.`;
  }
  const BY_ID: Record<string, string> = {
    schema_local:
      "Google can find this site, but it can't tell what the business does or where it is — so it doesn't show up in local searches.",
    nap: "Your name, address and phone aren't all on the page, so Google can't match you to your Google Business Profile.",
    title:
      "Your page title is doing none of the work — it's the blue line people click in Google, and it doesn't say what you do or where.",
    meta_description:
      "The site works, but the two lines under your link in Google aren't selling anything — so people scroll past to whoever's below you.",
    h1: "Nothing on the page tells Google what it's actually about.",
    content: "There isn't enough on the page for Google to match against what people search for.",
    viewport:
      "The site isn't set up for phones — which is where more than half the people looking for you are.",
    https: "Browsers are showing a 'Not secure' warning to everyone who visits.",
    image_alt: "Your photos are invisible to Google — they're a ranking asset earning you nothing.",
    social_preview:
      "When someone shares your site in a WhatsApp group it appears as a bare grey link nobody taps.",
    speed: "The site is slow enough to be losing visitors before they see anything.",
  };
  if (BY_ID[top.id]) return BY_ID[top.id];
  if (bigMisses === 0) {
    return "Nothing is badly broken — there are just a few easy wins left on the table.";
  }
  return `${bigMisses} big thing${bigMisses === 1 ? " is" : "s are"} holding this site back — all fixable today.`;
}

function gradeOf(score: number): SeoAudit["grade"] {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  if (score >= 40) return "D";
  return "F";
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

/**
 * The analysis half, with no network in it. Split out from runSeoAudit so the
 * checks can be exercised against saved HTML from real sites — the fetch is a
 * thin wrapper, the scoring is where mistakes would actually cost Jude
 * credibility with a business owner reading the report.
 */
export function auditFromHtml(input: {
  requestedUrl: string;
  finalUrl: string;
  html: string;
  loadMs: number;
  robotsTxt: string | null;
  sitemapXml: string | null;
}): SeoAudit {
  const finalUrl = new URL(input.finalUrl);
  const page: PageFetch = {
    html: input.html,
    finalUrl: input.finalUrl,
    loadMs: input.loadMs,
    bytes: input.html.length,
  };
  const facts = extractFacts(
    page,
    finalUrl.origin,
    finalUrl.hostname,
    input.robotsTxt,
    input.sitemapXml
  );
  const strip = (u: string) => u.replace(/\/+$/, "").toLowerCase();
  if (strip(input.finalUrl) !== strip(input.requestedUrl)) {
    facts.redirectedTo = input.finalUrl;
  }
  const built = buildChecks(facts, finalUrl.hostname);
  const blockers = built
    .filter((c) => SHOWSTOPPER_IDS.has(c.id) && c.status === "fail")
    .map((c) => ({ id: c.id, label: c.label }));
  const score = blockers.length
    ? Math.min(scoreOf(built), BLOCKED_CEILING)
    : scoreOf(built);
  // Worst-first, so the page can simply take checks[0] as "the one thing".
  const checks = built
    .map((c, i) => ({ c, p: priority(c, i) }))
    .sort((a, b) => a.p - b.p)
    .map((x) => x.c);
  return {
    url: input.requestedUrl,
    finalUrl: input.finalUrl,
    host: finalUrl.hostname,
    fetchedAt: new Date().toISOString(),
    score,
    grade: gradeOf(score),
    verdict: verdictFor(
      checks.find((c) => c.status !== "pass"),
      blockers.length > 0,
      checks.filter((c) => c.status === "fail" && c.impact === "high").length
    ),
    blockers,
    counts: {
      pass: checks.filter((c) => c.status === "pass").length,
      warn: checks.filter((c) => c.status === "warn").length,
      fail: checks.filter((c) => c.status === "fail").length,
    },
    checks,
    facts,
  };
}

/**
 * Audits one website. Never throws — every failure comes back as a typed
 * AuditFailure so the public page can say something useful instead of 500ing.
 */
export async function runSeoAudit(rawUrl: string): Promise<SeoAudit | AuditFailure> {
  let input = rawUrl.trim();
  if (!input) return { error: "invalid_url", message: "Enter a website address." };
  if (!/^https?:\/\//i.test(input)) input = `https://${input}`;

  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return { error: "invalid_url", message: "That doesn't look like a website address." };
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { error: "invalid_url", message: "Only http and https addresses can be checked." };
  }
  // Same guard the research engine uses: no localhost, no private ranges, no
  // cloud metadata endpoints. A public form that fetches arbitrary URLs is an
  // SSRF hole otherwise.
  if (!isPublicWebHost(parsed)) {
    return {
      error: "blocked_host",
      message: "That address isn't a public website, so it can't be checked.",
    };
  }

  const deadline = Date.now() + TOTAL_BUDGET_MS;
  const host = parsed.hostname;
  const altHost = host.startsWith("www.") ? host.slice(4) : `www.${host}`;

  // Try as given, then the www/non-www twin — plenty of SME hosts serve only
  // one of the two, and a failure there isn't the customer's problem to solve.
  let page: PageFetch | null = null;
  for (const candidate of [
    parsed.toString(),
    `${parsed.protocol}//${altHost}${parsed.pathname}`,
    `http://${host}${parsed.pathname}`,
  ]) {
    if (Date.now() > deadline - 2000) break;
    try {
      page = await fetchPage(candidate, Math.min(PAGE_TIMEOUT_MS, deadline - Date.now()));
      if (page) break;
    } catch {
      // try the next shape
    }
  }
  if (!page) {
    return {
      error: "unreachable",
      message:
        "Couldn't load that site — it may be down, blocking automated visitors, or the address may have a typo.",
    };
  }
  if (page.html.length < 200) {
    return {
      error: "empty",
      message: "That page returned almost no content, so there's nothing to check yet.",
    };
  }

  const finalUrl = new URL(page.finalUrl);
  const origin = finalUrl.origin;

  // robots.txt and sitemap.xml in parallel, both optional.
  const sideBudget = Math.max(0, Math.min(SIDE_TIMEOUT_MS, deadline - Date.now()));
  const [robotsRaw, sitemapRaw] =
    sideBudget < 800
      ? [null, null]
      : await Promise.all([
          fetchText(`${origin}/robots.txt`, sideBudget),
          fetchText(`${origin}/sitemap.xml`, sideBudget),
        ]);

  // Everything from here is pure analysis — no network, and separately tested.
  return auditFromHtml({
    requestedUrl: parsed.toString(),
    finalUrl: page.finalUrl,
    html: page.html,
    loadMs: page.loadMs,
    robotsTxt: robotsRaw,
    sitemapXml: sitemapRaw,
  });
}

export function isAuditFailure(r: SeoAudit | AuditFailure): r is AuditFailure {
  return "error" in r;
}
