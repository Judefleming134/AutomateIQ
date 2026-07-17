import "server-only";
import { aiComplete } from "@/lib/ai/complete";
import { activeEngineLabel, CLAUDE_MODEL, GEMINI_MODEL } from "@/lib/ai/config";
import {
  SOLUTION_CATALOG,
  sanitizeRecommendations,
  type SolutionRecommendation,
} from "@/lib/growth/solutions";
import { CRITERIA, type CriterionKey } from "@/lib/growth/scoring";
import type { ProspectContext } from "@/lib/growth/ai";

export type ResearchReport = {
  overview: string;
  industry: string;
  services: string[];
  business_model: string;
  company_size: string;
  operational_observations: string[];
  manual_processes: string[];
  inefficiencies: string[];
  ai_opportunities: string[];
  conversation_starters: string[];
  discovery_questions: string[];
  proposal_angle: string;
  next_action: string;
};

export type ChannelDrafts = {
  linkedin: string;
  instagram: string;
  facebook: string;
  email: { subject: string; body: string };
  sms: string;
};

/** Contact details harvested from the prospect's own website. */
export type FoundContacts = {
  email?: string;
  phone?: string;
  instagram_url?: string;
  facebook_url?: string;
  linkedin_url?: string;
};

export type ResearchResult = {
  report: ResearchReport;
  solutions: SolutionRecommendation[];
  ratings: Partial<Record<CriterionKey, number>>;
  drafts: ChannelDrafts;
  websiteFetched: boolean;
  /** Which model produced this research, e.g. "Claude (claude-sonnet-5)". */
  engine: string;
  /** Emails/phones/social links found on the site — fills blank CRM fields. */
  found: FoundContacts;
};

/**
 * Pulls contact details out of raw page HTML: mailto/tel links first (most
 * reliable), then visible email addresses, plus the first Instagram /
 * Facebook / LinkedIn profile link. SME sites almost always put these in
 * the header or footer, so the homepage is usually enough.
 */
function harvestContacts(html: string, siteHost: string): FoundContacts {
  const found: FoundContacts = {};

  const mailto = /href=["']mailto:([^"'?]+)/i.exec(html);
  const emailRe = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
  const junk = /\.(png|jpe?g|gif|webp|svg)$|wixpress|sentry|example\.|@2x|schema\.org/i;
  let email = mailto?.[1]?.trim();
  if (!email) {
    const all = (html.match(emailRe) ?? []).filter((e) => !junk.test(e));
    // Prefer an address on the company's own domain.
    const root = siteHost.replace(/^www\./, "");
    email = all.find((e) => e.toLowerCase().endsWith(`@${root}`)) ?? all[0];
  }
  if (email && emailRe.test(email) && !junk.test(email)) {
    found.email = email.toLowerCase().slice(0, 200);
  }

  const tel = /href=["']tel:([^"']+)/i.exec(html);
  if (tel) {
    const phone = tel[1].replace(/[^+\d ()-]/g, "").trim();
    if (phone.replace(/\D/g, "").length >= 7) found.phone = phone.slice(0, 40);
  }

  const socialRe =
    /https?:\/\/(?:www\.|m\.|web\.|ie-ie\.)?(facebook\.com|instagram\.com|linkedin\.com)\/[A-Za-z0-9_.\/?=&%-]*/gi;
  for (const m of html.matchAll(socialRe)) {
    const cleaned = cleanSocialUrl(m[0]);
    if (!cleaned) continue;
    const key = m[1].toLowerCase().startsWith("facebook")
      ? "facebook_url"
      : m[1].toLowerCase().startsWith("instagram")
        ? "instagram_url"
        : "linkedin_url";
    if (!found[key]) found[key] = cleaned;
  }

  return found;
}

/**
 * Canonicalises a candidate social link to a real profile/page URL, or
 * returns null for site furniture. This exists because templates are full
 * of landmines that LOOK like profile links: bare "facebook.com/" icon
 * placeholders, old-WordPress "facebook.com/2008/fbml" namespace tags,
 * link shims (l.php), share buttons, pixel/tr endpoints, and Instagram
 * post links — all of which previously got harvested as "their page" and
 * handed to Jude as dead DM targets. Also the source of truth for spotting
 * junk already saved in the CRM (null = dead, replace or clear it).
 */
export function cleanSocialUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.replace(/[/.,)"']+$/, ""));
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^(www|m|web|ie-ie)\./, "");
  const segs = u.pathname.split("/").filter(Boolean);
  // Bare "facebook.com/" — a template's unfilled social icon, not a page.
  if (segs.length === 0) return null;
  const first = segs[0].toLowerCase();

  if (host === "facebook.com") {
    const junk = new Set([
      "sharer", "sharer.php", "share", "share.php", "dialog", "plugins",
      "tr", "l.php", "login", "login.php", "badge", "embed", "hashtag",
      "2008", "fbml", "video", "watch", "events", "help", "policies",
      "privacy", "legal", "business", "ads", "home.php", "photo",
      "photo.php", "story.php",
    ]);
    if (junk.has(first)) return null;
    if (first === "profile.php") {
      const id = u.searchParams.get("id");
      return id && /^\d+$/.test(id)
        ? `https://www.facebook.com/profile.php?id=${id}`
        : null;
    }
    if (["pages", "people", "groups", "pg"].includes(first)) {
      if (segs.length < 2) return null;
      return `https://www.facebook.com/${segs.slice(0, 3).join("/")}`;
    }
    // Vanity page: the handle alone is the page.
    return `https://www.facebook.com/${segs[0]}`;
  }

  if (host === "instagram.com") {
    const junk = new Set([
      "p", "reel", "reels", "tv", "stories", "explore", "accounts",
      "embed", "embed.js", "share", "directory", "developer", "about",
      "legal", "web", "static",
    ]);
    if (junk.has(first)) return null;
    const handle = segs[0].replace(/[^A-Za-z0-9._]/g, "");
    return handle ? `https://www.instagram.com/${handle}/` : null;
  }

  if (host === "linkedin.com") {
    if (!["company", "in", "school", "showcase"].includes(first)) return null;
    if (segs.length < 2) return null;
    return `https://www.linkedin.com/${segs.slice(0, 2).join("/")}/`;
  }

  return null;
}

/**
 * Fetches the prospect's website, harvests contact details from the raw
 * HTML, and reduces the page to plain text the model can read. Best-effort:
 * any failure (site down, bot-blocked, not HTML) returns null and research
 * continues from the details we already hold — the report then plainly says
 * it's working without the site.
 */
/** One fetch attempt of a single URL. Uses a real desktop-Chrome header
 *  set — SME sites behind Cloudflare/WAFs routinely 403 a "compatible;
 *  Bot" agent, which was silently failing half of Jude's reads. */
async function fetchOnce(
  target: string
): Promise<{ text: string; found: FoundContacts } | null> {
  const res = await fetch(target, {
    redirect: "follow",
    signal: AbortSignal.timeout(12000),
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "accept-language": "en-IE,en-GB;q=0.9,en;q=0.8",
      "accept-encoding": "gzip, deflate, br",
      "upgrade-insecure-requests": "1",
    },
  });
  if (!res.ok) return null;
  const type = res.headers.get("content-type") ?? "";
  if (type && !type.includes("html") && !type.includes("text")) return null;

  const html = (await res.text()).slice(0, 500_000);
  const found = harvestContacts(html, new URL(target).hostname);
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    // Keep meta description/title content before stripping tags.
    .replace(/<meta[^>]+content="([^"]*)"[^>]*>/gi, " $1 ")
    .replace(/<title[^>]*>([\s\S]*?)<\/title>/i, " PAGE TITLE: $1 ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#?\w+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return text.length >= 60 ? { text: text.slice(0, 9000), found } : null;
}

/**
 * SSRF guard: website URLs arrive from bulk-imported CSVs (scraper output),
 * so the server must refuse to fetch anything that isn't a public website —
 * loopback/link-local/private addresses, cloud metadata endpoints, bare
 * hostnames and non-standard ports could otherwise probe infrastructure
 * from inside the deployment ~100×/night.
 */
function isPublicWebHost(u: URL): boolean {
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

export async function fetchWebsiteText(
  rawUrl: string
): Promise<{ text: string; found: FoundContacts } | null> {
  let url = rawUrl.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(parsed.protocol)) return null;
  if (!isPublicWebHost(parsed)) return null;

  // Try the URL as given, then the www/non-www variant, then http — a slow
  // or picky host that fails one shape often serves another. First success
  // wins; total failure returns null and research hedges without the site.
  const host = parsed.hostname;
  const altHost = host.startsWith("www.") ? host.slice(4) : `www.${host}`;
  const candidates = [
    parsed.toString(),
    `${parsed.protocol}//${altHost}${parsed.pathname}${parsed.search}`,
    `http://${host}${parsed.pathname}${parsed.search}`,
  ];
  for (const candidate of candidates) {
    try {
      const result = await fetchOnce(candidate);
      if (result) return result;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

function asStringArray(v: unknown, max = 10): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x) => typeof x === "string" && x.trim())
    .map((x) => (x as string).trim().slice(0, 600))
    .slice(0, max);
}

function asString(v: unknown, max = 2000): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/** Pulls the first JSON object out of a model response (handles ```json fences). */
function extractJson(raw: string): Record<string, unknown> | null {
  const stripped = raw.replace(/```json|```/g, "").trim();
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(stripped.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const S = { type: "string" } as const;
const S_ARR = { type: "array", items: S } as const;

/**
 * JSON Schema for the research package, enforced server-side on Claude via
 * structured outputs — the model physically cannot return anything but this
 * shape, so BAD_JSON is impossible there. Gemini ignores it (its schema
 * dialect differs) and relies on JSON mode + the prompt's shape example.
 */
function researchSchema(): Record<string, unknown> {
  const ratingProps: Record<string, unknown> = {};
  for (const c of CRITERIA) ratingProps[c.key] = { type: "integer" };
  return {
    type: "object",
    properties: {
      report: {
        type: "object",
        properties: {
          overview: S, industry: S, services: S_ARR, business_model: S,
          company_size: S, operational_observations: S_ARR,
          manual_processes: S_ARR, inefficiencies: S_ARR,
          ai_opportunities: S_ARR, conversation_starters: S_ARR,
          discovery_questions: S_ARR, proposal_angle: S, next_action: S,
        },
        required: [
          "overview", "industry", "services", "business_model",
          "company_size", "operational_observations", "manual_processes",
          "inefficiencies", "ai_opportunities", "conversation_starters",
          "discovery_questions", "proposal_angle", "next_action",
        ],
        additionalProperties: false,
      },
      solutions: {
        type: "array",
        items: {
          type: "object",
          properties: { key: S, why: S, complexity: S, benefits: S },
          required: ["key", "why", "complexity", "benefits"],
          additionalProperties: false,
        },
      },
      ratings: {
        type: "object",
        properties: ratingProps,
        required: Object.keys(ratingProps),
        additionalProperties: false,
      },
      drafts: {
        type: "object",
        properties: {
          linkedin: S, instagram: S, facebook: S,
          email: {
            type: "object",
            properties: { subject: S, body: S },
            required: ["subject", "body"],
            additionalProperties: false,
          },
          sms: S,
        },
        required: ["linkedin", "instagram", "facebook", "email", "sms"],
        additionalProperties: false,
      },
    },
    required: ["report", "solutions", "ratings", "drafts"],
    additionalProperties: false,
  };
}

/**
 * ONE model call produces the whole research package: report + solution
 * recommendations + suggested qualification ratings + a first-touch draft
 * per channel. One call keeps the action inside serverless time limits and
 * keeps every part of the package consistent with the same analysis.
 */
export async function runCompanyResearch(
  prospect: ProspectContext & { email?: string | null; phone?: string | null }
): Promise<ResearchResult> {
  const site = prospect.website
    ? await fetchWebsiteText(prospect.website)
    : null;
  const websiteText = site?.text ?? null;

  const catalog = SOLUTION_CATALOG.map(
    (s) => `- key: ${s.key} — ${s.name}: ${s.blurb}`
  ).join("\n");

  const ratingGuide = CRITERIA.map(
    (c) => `"${c.key}": 0-3 (${c.options.join(" / ")})`
  ).join(", ");

  const system = [
    "You are the senior business analyst and sales strategist at AutomateIQ, an Irish AI-automation agency (automateiq.ie) selling practical AI systems to small and mid-sized businesses. The commercial goal is a free 30-minute AI Strategy Session.",
    "You produce honest, useful company research. HARD RULES:",
    "- Ground every claim in the provided website text and prospect details. Where you must infer, use hedged language ('likely', 'typically for this sector') — NEVER present a guess as fact.",
    "- Never invent named clients, revenue figures, staff counts or certifications.",
    "- All operational-benefit statements are ILLUSTRATIVE estimates for this type of business, never guarantees.",
    "- Outreach drafts must read like one busy professional writing to another: specific, short, no hype, no 'I hope this finds you well'.",
    "- SENDER IDENTITY (unbreakable): every outreach draft is written by JUDE, the founder of AutomateIQ, in the first person. Sign as 'Jude' / 'Jude, AutomateIQ' (or plain 'AutomateIQ' in short SMS). NEVER invent any other name, NEVER use placeholders like [Your Name], and NEVER give Jude a job title such as 'Business Analyst' — your analyst role above is for the report only, it must not appear in any draft.",
    "Respond with ONLY a valid JSON object — no markdown fences, no commentary.",
  ].join("\n");

  const genericContact = ["owner", "unknown", "team", "there", ""].includes(
    prospect.contact_name.trim().toLowerCase()
  );

  const prompt = [
    "PROSPECT:",
    `- Company: ${prospect.company}`,
    genericContact
      ? "- Contact: name unknown — open all drafts without a personal name (e.g. 'Hi there,')"
      : `- Contact: ${prospect.contact_name}${prospect.job_title ? `, ${prospect.job_title}` : ""}`,
    prospect.industry ? `- Industry (as recorded): ${prospect.industry}` : "",
    prospect.location ? `- Location: ${prospect.location}` : "",
    prospect.website
      ? `- Website: ${prospect.website}`
      : "- Website: NONE — this business has no website",
    prospect.notes
      ? `- SALESPERSON'S FIELD NOTES (first-hand observations from finding this lead — weigh these heavily and build the recommendations and outreach angle around them): ${prospect.notes}`
      : "",
    "",
    websiteText
      ? `WEBSITE CONTENT (extracted text):\n${websiteText}`
      : prospect.website
        ? "WEBSITE CONTENT: could not be retrieved — analyse from the details above plus what is typical for this kind of business, and hedge accordingly."
        : "WEBSITE CONTENT: this business has NO WEBSITE. Treat that as a primary finding, not a data gap: they are likely invisible on Google, losing after-hours and comparison-shopping enquiries to competitors who do show up. The 'website-lead-capture' solution should almost certainly lead your recommendations, and the outreach drafts should be built around that angle. Analyse the rest from the details above plus what is typical for this kind of business, hedging accordingly.",
    "",
    "AUTOMATEIQ SOLUTION CATALOGUE (recommend ONLY from these keys):",
    catalog,
    "",
    "Return JSON with EXACTLY this shape:",
    `{
  "report": {
    "overview": "2-4 sentence company overview",
    "industry": "primary industry, 2-4 words",
    "services": ["what they sell/do", "..."],
    "business_model": "how they make money, 1-2 sentences",
    "company_size": "best estimate with hedging, e.g. 'Likely 5-15 staff based on ...'",
    "operational_observations": ["concrete observations about how they operate", "..."],
    "manual_processes": ["processes that are probably manual today", "..."],
    "inefficiencies": ["likely inefficiencies/bottlenecks", "..."],
    "ai_opportunities": ["specific AI/automation opportunities", "..."],
    "conversation_starters": ["3 openers referencing something real about them"],
    "discovery_questions": ["5 questions to ask on a call"],
    "proposal_angle": "the single strongest angle for a proposal, 1-2 sentences",
    "next_action": "the recommended immediate next step for the salesperson"
  },
  "solutions": [
    { "key": "catalogue key", "why": "why it fits THIS business, 1-2 sentences", "complexity": "low|medium|high", "benefits": "illustrative operational improvements, hedged" }
  ],
  "ratings": { ${ratingGuide} },
  "drafts": {
    "linkedin": "first-touch LinkedIn DM, under 500 characters, no subject, from Jude",
    "instagram": "first-touch Instagram DM, 2-3 sentences, warm and informal, sign as Jude from AutomateIQ",
    "facebook": "first-touch Facebook page message, 2-4 sentences, plain-spoken and local in feel, sign as Jude from AutomateIQ",
    "email": { "subject": "cold-email subject built for opens: 3-6 words, under 40 chars, lowercase except proper nouns, naming ONE specific thing about THIS business (missed calls / reviews / no website / their trade + area) — reads like a note from someone they know, never salesy; no exclamation marks, no 'free/offer/deal'", "body": "80-140 word first-touch email, sign off as Jude, AutomateIQ" },
    "sms": "first-touch SMS under 320 characters, sign as AutomateIQ"
  }
}`,
    "",
    "3 to 6 solutions, ordered by fit. Ratings reflect what the research supports; use 0 where unknown (budget and timeline are usually 0 before a conversation).",
  ]
    .filter(Boolean)
    .join("\n");

  // effort "medium": this is grounded analysis + writing, not deep multi-step
  // reasoning — sonnet-5's default ("high") thinks for minutes per company
  // for no material quality gain on this task.
  // Track who ACTUALLY answered: with account-failover live, the configured
  // provider and the serving provider can differ, and the stored engine
  // label must tell the truth.
  let servedBy: "anthropic" | "gemini" | null = null;
  const raw = await aiComplete(system, prompt, 8000, {
    json: true,
    effort: "medium",
    schema: researchSchema(),
    onProvider: (p) => {
      servedBy = p;
    },
  });
  const parsed = extractJson(raw);
  if (!parsed) throw new Error("BAD_JSON");

  const r = (parsed.report ?? {}) as Record<string, unknown>;
  const report: ResearchReport = {
    overview: asString(r.overview),
    industry: asString(r.industry, 120),
    services: asStringArray(r.services),
    business_model: asString(r.business_model),
    company_size: asString(r.company_size, 300),
    operational_observations: asStringArray(r.operational_observations),
    manual_processes: asStringArray(r.manual_processes),
    inefficiencies: asStringArray(r.inefficiencies),
    ai_opportunities: asStringArray(r.ai_opportunities),
    conversation_starters: asStringArray(r.conversation_starters, 5),
    discovery_questions: asStringArray(r.discovery_questions, 8),
    proposal_angle: asString(r.proposal_angle),
    next_action: asString(r.next_action, 600),
  };
  if (!report.overview) throw new Error("BAD_JSON");

  const ratingsRaw = (parsed.ratings ?? {}) as Record<string, unknown>;
  const ratings: Partial<Record<CriterionKey, number>> = {};
  for (const c of CRITERIA) {
    const v = Number(ratingsRaw[c.key]);
    if (Number.isInteger(v) && v >= 0 && v <= 3) ratings[c.key] = v;
  }

  const d = (parsed.drafts ?? {}) as Record<string, unknown>;
  const email = (d.email ?? {}) as Record<string, unknown>;
  const drafts: ChannelDrafts = {
    linkedin: asString(d.linkedin, 2000),
    instagram: asString(d.instagram, 2000),
    facebook: asString(d.facebook, 2000),
    email: {
      subject: asString(email.subject, 200) || `question about ${prospect.company}`,
      body: asString(email.body, 4000),
    },
    sms: asString(d.sms, 400),
  };

  return {
    report,
    solutions: sanitizeRecommendations(parsed.solutions),
    ratings,
    drafts,
    websiteFetched: websiteText !== null,
    engine:
      servedBy === "gemini"
        ? `Gemini (${GEMINI_MODEL}, free tier)`
        : servedBy === "anthropic"
          ? `Claude (${CLAUDE_MODEL})`
          : activeEngineLabel(),
    found: site?.found ?? {},
  };
}
