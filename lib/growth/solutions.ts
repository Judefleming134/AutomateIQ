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
};

export const SOLUTION_CATALOG: Solution[] = [
  {
    key: "ai-receptionist",
    name: "AI Receptionist",
    blurb:
      "Answers calls and enquiries 24/7, captures every lead, books appointments and routes urgent matters to a human.",
  },
  {
    key: "voice-ai",
    name: "Voice AI",
    blurb:
      "Natural-voice phone agents for inbound/outbound calls: reminders, confirmations, qualification and customer service.",
  },
  {
    key: "workforce-management",
    name: "Workforce Management",
    blurb:
      "Rostering, timesheets, job allocation and field-team coordination without spreadsheets and phone-tag.",
  },
  {
    key: "asset-management",
    name: "Asset Management",
    blurb:
      "Tracks equipment, vehicles, tools and maintenance schedules with service history and automated reminders.",
  },
  {
    key: "hsc-compliance",
    name: "Health, Safety & Compliance (incl. SOP management)",
    blurb:
      "Digital SOPs, inspections, incident reporting, certifications and audit trails — always inspection-ready.",
  },
  {
    key: "finance-invoice-automation",
    name: "Finance & Invoice Automation",
    blurb:
      "Automated invoicing, payment chasing, reconciliation and cash-flow visibility.",
  },
  {
    key: "erp-platform",
    name: "ERP Platform",
    blurb:
      "An integrated operations backbone inspired by enterprise systems such as SAP — sized and priced for SMEs.",
  },
  {
    key: "business-operations-platform",
    name: "Business Operations Platform",
    blurb:
      "One workspace connecting jobs, customers, documents, tasks and reporting across the whole business.",
  },
  {
    key: "ai-logistics",
    name: "AI Logistics Control Centre",
    blurb:
      "Route planning, dispatch, delivery tracking and exception alerts for transport and distribution operations.",
  },
  {
    key: "review-agent",
    name: "Review Agent",
    blurb:
      "Automated Google-review collection with perfectly timed requests and one polite reminder.",
  },
  {
    key: "instant-quote-agent",
    name: "Instant Quote Agent",
    blurb:
      "Turns a job description into an itemised quote from the business's own price guide, sent and accepted online.",
  },
  {
    key: "speed-to-lead",
    name: "Speed-to-Lead Agent",
    blurb:
      "Replies personally to every new website lead within seconds, before a competitor does.",
  },
  {
    key: "ai-assistant",
    name: "AI Assistant",
    blurb:
      "A website/chat assistant grounded in the business's real services, prices and policies.",
  },
  {
    key: "bespoke-ai-software",
    name: "Bespoke AI Software",
    blurb:
      "Custom-built AI systems for processes no off-the-shelf tool fits — designed around how the business actually works.",
  },
];

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
