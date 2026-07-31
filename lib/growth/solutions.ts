/**
 * The catalogue the AI Solution Matcher recommends from. Every research run
 * picks 3–6 of these for the prospect and explains why, with an
 * implementation-complexity rating and ILLUSTRATIVE (never guaranteed)
 * operational benefits. Shared by prompts, display and analytics — pure data.
 */

export type SolutionComplexity = "low" | "medium" | "high";

export type Solution = {
  key: string;
  name: string;
  blurb: string;
  /**
   * The proven "first-customer" wedge — fast to deploy, immediate ROI, and
   * relevant to almost every SMB with a phone and a Google listing. The
   * research matcher leads its recommendations (and therefore the pitch, the
   * quote and the drafts) with these wherever they honestly fit.
   */
  flagship?: boolean;
};

export const SOLUTION_CATALOG: Solution[] = [
  {
    key: "ai-receptionist",
    name: "ReceptionIQ",
    blurb:
      "Answers calls and enquiries 24/7, captures every lead, books appointments and routes urgent matters to a human.",
    flagship: true,
  },
  {
    key: "voice-ai",
    name: "VoiceIQ",
    blurb:
      "Natural-voice phone agents for inbound/outbound calls: reminders, confirmations, qualification and customer service.",
  },
  {
    key: "workforce-management",
    name: "WorkforceIQ",
    blurb:
      "Rostering, timesheets, job allocation and field-team coordination without spreadsheets and phone-tag.",
  },
  {
    key: "asset-management",
    name: "AssetIQ",
    blurb:
      "Tracks equipment, vehicles, tools and maintenance schedules with service history and automated reminders.",
  },
  {
    key: "hsc-compliance",
    name: "SafetyIQ",
    blurb:
      "Digital SOPs, inspections, incident reporting, certifications and audit trails — always inspection-ready.",
  },
  {
    key: "finance-invoice-automation",
    name: "FinanceIQ",
    blurb:
      "Automated invoicing, payment chasing, reconciliation and cash-flow visibility.",
  },
  {
    key: "erp-platform",
    name: "EnterpriseIQ",
    blurb:
      "An integrated operations backbone inspired by enterprise systems such as SAP — sized and priced for SMEs.",
  },
  {
    key: "business-operations-platform",
    name: "OperationsIQ",
    blurb:
      "One workspace connecting jobs, customers, documents, tasks and reporting across the whole business.",
  },
  {
    key: "ai-logistics",
    name: "FleetIQ",
    blurb:
      "Route planning, dispatch, delivery tracking and exception alerts for transport and distribution operations.",
  },
  {
    key: "website-lead-capture",
    name: "SiteIQ",
    blurb:
      "A professional website with built-in lead capture and instant enquiry alerts — for businesses with no site (or a dead one) who are invisible on Google and losing after-hours enquiries to competitors.",
  },
  {
    key: "review-agent",
    name: "ReputationIQ",
    blurb:
      "Automated Google-review collection with perfectly timed requests and one polite reminder.",
    flagship: true,
  },
  {
    key: "instant-quote-agent",
    name: "QuoteIQ",
    blurb:
      "Turns a job description into an itemised quote from the business's own price guide, sent and accepted online.",
  },
  {
    key: "speed-to-lead",
    name: "LeadIQ",
    blurb:
      "Replies personally to every new website lead within seconds, before a competitor does.",
    flagship: true,
  },
  {
    key: "ai-assistant",
    name: "AssistIQ",
    blurb:
      "A website/chat assistant grounded in the business's real services, prices and policies.",
  },
  {
    key: "bespoke-ai-software",
    name: "BespokeIQ",
    blurb:
      "Custom-built AI systems for processes no off-the-shelf tool fits — designed around how the business actually works.",
  },
];

/**
 * The flagship "lead-with" keys, in the order they should be pitched — the
 * receptionist (missed after-hours calls), speed-to-lead (slow response) and
 * review agent (thin Google reviews). Each removes a sharp, felt pain with a
 * quick install, which is what lands first customers.
 */
export const FLAGSHIP_SOLUTION_KEYS: string[] = SOLUTION_CATALOG.filter(
  (s) => s.flagship
).map((s) => s.key);

export type SolutionRecommendation = {
  key: string;
  name: string;
  why: string;
  complexity: SolutionComplexity;
  benefits: string; // illustrative, never a guarantee
};

const byKey = new Map(SOLUTION_CATALOG.map((s) => [s.key, s]));

/** Validates AI output rows against the catalogue; drops anything unknown. */
export function sanitizeRecommendations(raw: unknown): SolutionRecommendation[] {
  if (!Array.isArray(raw)) return [];
  const out: SolutionRecommendation[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const r = item as Record<string, unknown>;
    const key = String(r.key ?? "");
    const known = byKey.get(key);
    if (!known) continue;
    const complexity = ["low", "medium", "high"].includes(String(r.complexity))
      ? (String(r.complexity) as SolutionComplexity)
      : "medium";
    out.push({
      key,
      name: known.name,
      why: String(r.why ?? "").slice(0, 1000),
      complexity,
      benefits: String(r.benefits ?? "").slice(0, 1000),
    });
    if (out.length >= 6) break;
  }
  return out;
}

export const COMPLEXITY_META: Record<SolutionComplexity, { label: string; badge: string }> = {
  low: { label: "Low complexity", badge: "badge-green" },
  medium: { label: "Medium complexity", badge: "badge-orange" },
  high: { label: "Larger project", badge: "badge-blue" },
};
