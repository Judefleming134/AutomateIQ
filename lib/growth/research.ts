import "server-only";
import { aiComplete } from "@/lib/ai/complete";
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

export type ResearchResult = {
  report: ResearchReport;
  solutions: SolutionRecommendation[];
  ratings: Partial<Record<CriterionKey, number>>;
  drafts: ChannelDrafts;
  websiteFetched: boolean;
};

/**
 * Fetches the prospect's website and reduces it to plain text the model can
 * read. Best-effort: any failure (site down, bot-blocked, not HTML) returns
 * null and research continues from the details we already hold — the report
 * then plainly says it's working without the site.
 */
export async function fetchWebsiteText(rawUrl: string): Promise<string | null> {
  let url = rawUrl.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;

    const res = await fetch(parsed.toString(), {
      redirect: "follow",
      signal: AbortSignal.timeout(12000),
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

    return text.length >= 80 ? text.slice(0, 9000) : null;
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

/**
 * ONE model call produces the whole research package: report + solution
 * recommendations + suggested qualification ratings + a first-touch draft
 * per channel. One call keeps the action inside serverless time limits and
 * keeps every part of the package consistent with the same analysis.
 */
export async function runCompanyResearch(
  prospect: ProspectContext & { email?: string | null; phone?: string | null }
): Promise<ResearchResult> {
  const websiteText = prospect.website
    ? await fetchWebsiteText(prospect.website)
    : null;

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
    prospect.website ? `- Website: ${prospect.website}` : "- Website: none provided",
    prospect.notes ? `- Team notes: ${prospect.notes}` : "",
    "",
    websiteText
      ? `WEBSITE CONTENT (extracted text):\n${websiteText}`
      : "WEBSITE CONTENT: could not be retrieved — analyse from the details above plus what is typical for this kind of business, and hedge accordingly.",
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
    "email": { "subject": "short specific subject", "body": "80-140 word first-touch email, sign off as AutomateIQ" },
    "sms": "first-touch SMS under 320 characters, sign as AutomateIQ"
  }
}`,
    "",
    "3 to 6 solutions, ordered by fit. Ratings reflect what the research supports; use 0 where unknown (budget and timeline are usually 0 before a conversation).",
  ]
    .filter(Boolean)
    .join("\n");

  const raw = await aiComplete(system, prompt, 8000, { json: true });
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
      subject: asString(email.subject, 200) || `A quick idea for ${prospect.company}`,
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
  };
}
