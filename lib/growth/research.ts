import "server-only";
import { aiComplete } from "@/lib/ai/complete";
import { activeEngineLabel } from "@/lib/ai/config";
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

  const social = (domain: string) => {
    const re = new RegExp(
      `https?://(?:www\\.)?${domain}/[A-Za-z0-9_./-]+`,
      "gi"
    );
    for (const m of html.matchAll(re)) {
      const url = m[0].replace(/[/.]+$/, "");
      // Skip share/intent/widget links — they aren't the company profile.
      if (/\/(sharer|share|intent|plugins|tr|badge|embed)\b/i.test(url)) continue;
      return url.slice(0, 300);
    }
    return undefined;
  };
  found.instagram_url = social("instagram\\.com");
  found.facebook_url = social("facebook\\.com");
  found.linkedin_url = social("linkedin\\.com");

  return found;
}

/**
 * Fetches the prospect's website, harvests contact details from the raw
 * HTML, and reduces the page to plain text the model can read. Best-effort:
 * any failure (site down, bot-blocked, not HTML) returns null and research
 * continues from the details we already hold — the report then plainly says
 * it's working without the site.
 */
export async function fetchWebsiteText(
  rawUrl: string
): Promise<{ text: string; found: FoundContacts } | null> {
  let url = rawUrl.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;

    const res = await fetch(parsed.toString(), {
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
      headers: {
        // Some SME sites block requests with no UA at all.
        "user-agent":
          "Mozilla/5.0 (compatible; AutomateIQ-Research/1.0; +https://automateiq.ie)",
        accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("html") && !type.includes("text")) return null;

    const html = (await res.text()).slice(0, 500_000);
    const found = harvestContacts(html, parsed.hostname);
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

    return text.length >= 80 ? { text: text.slice(0, 9000), found } : null;
  } catch {
    return null;
  }
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
    "linkedin": "first-touch LinkedIn DM, under 500 characters, no subject",
    "instagram": "first-touch Instagram DM, 2-3 sentences, warm and informal",
    "facebook": "first-touch Facebook page message, 2-4 sentences, plain-spoken and local in feel",
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
  const raw = await aiComplete(system, prompt, 8000, {
    json: true,
    effort: "medium",
    schema: researchSchema(),
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
    engine: activeEngineLabel(),
    found: site?.found ?? {},
  };
}
