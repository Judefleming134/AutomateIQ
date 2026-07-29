import "server-only";
import { aiComplete } from "@/lib/ai/complete";
import type { ProspectContext } from "@/lib/growth/ai";
import type { ResearchReport } from "@/lib/growth/research";
import type { SolutionRecommendation } from "@/lib/growth/solutions";
import { pricingLines } from "@/lib/growth/pricing";

/**
 * Drafts a client-ready proposal in Markdown from everything the CRM knows:
 * the research report, the recommended solutions and any meeting notes. The
 * output is a DRAFT for human editing in the Proposal Studio — benefits are
 * always framed as illustrative, and unknowns are left as [placeholders]
 * rather than invented.
 */
export async function generateProposalMarkdown(
  prospect: ProspectContext,
  report: ResearchReport | null,
  solutions: SolutionRecommendation[],
  meetingNotes: string[]
): Promise<string> {
  // Only the solutions that actually have a published rate. Computed once so
  // the prompt block below can be gated on real priced lines rather than on
  // how many solutions happen to be recommended.
  const priceBookLines = pricingLines(solutions.map((s) => s.key));

  const system = [
    "You write commercial proposals for AutomateIQ, an Irish AI-automation agency (automateiq.ie).",
    "Audience: the business owner. Voice: clear, confident, jargon-free, professional.",
    "HARD RULES:",
    "- Ground everything in the provided research and notes. Never invent client names, revenue figures or specifics. Where a detail must be confirmed, write it as a bracketed placeholder like [confirm current call volume].",
    "- All operational-benefit statements are ILLUSTRATIVE estimates, clearly framed as such — never guarantees.",
    "- PRICING: use ONLY the founding-customer rates in the PRICE BOOK lines below — never any other figure. Present them as an 'Investment' line per recommended solution, framed as founding-customer rates: available to AutomateIQ's first 10 customers only, locked for the first year, subject to final scope. If no price book lines are provided, do not mention money at all.",
    "Output ONLY the proposal as clean Markdown. Use ## for section headings.",
  ].join("\n");

  // The report is AI-generated JSONB cast (not validated) on read, so a
  // legacy or field-evolved report can have `overview` set but be missing a
  // list field entirely. Coerce to real arrays before .length/.join so a
  // malformed report degrades to "less detail" instead of throwing — a throw
  // here surfaces to Jude as a misleading "try again in a moment" that never
  // clears (the data is the same on retry).
  const arr = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);
  const services = arr(report?.services);
  const manualProcesses = arr(report?.manual_processes);
  const inefficiencies = arr(report?.inefficiencies);
  const researchBlock = report?.overview
    ? [
        "RESEARCH:",
        `- Overview: ${report.overview}`,
        `- Business model: ${report.business_model}`,
        services.length ? `- Services: ${services.join("; ")}` : "",
        manualProcesses.length
          ? `- Likely manual processes: ${manualProcesses.join("; ")}`
          : "",
        inefficiencies.length
          ? `- Likely inefficiencies: ${inefficiencies.join("; ")}`
          : "",
        report.proposal_angle ? `- Strongest angle: ${report.proposal_angle}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "RESEARCH: none on file — keep the overview and challenges general and hedged.";

  const prompt = [
    `Write a proposal for ${prospect.company} with EXACTLY these sections:`,
    "## Company Overview",
    "## Business Challenges",
    "## Recommended AutomateIQ Solutions",
    "## Recommended Business Systems",
    "## Implementation Overview",
    "## Estimated Timeline",
    "## Illustrative Operational Benefits",
    "## Next Steps",
    "",
    "PROSPECT:",
    `- Company: ${prospect.company}`,
    `- Contact: ${prospect.contact_name}${prospect.job_title ? `, ${prospect.job_title}` : ""}`,
    prospect.industry ? `- Industry: ${prospect.industry}` : "",
    prospect.location ? `- Location: ${prospect.location}` : "",
    "",
    researchBlock,
    "",
    solutions.length
      ? `RECOMMENDED SOLUTIONS (structure the two recommendation sections around these):\n${solutions
          .map((s) => `- ${s.name} (${s.complexity} complexity): ${s.why} Illustrative benefits: ${s.benefits}`)
          .join("\n")}`
      : "RECOMMENDED SOLUTIONS: none saved — propose the most plausible AutomateIQ fits, hedged.",
    "",
    // Gated on PRICED lines, not on solutions. pricingLines() drops any key
    // that has no published rate, so a prospect whose recommendations are all
    // unpriced produced a "PRICE BOOK (the only money figures permitted):"
    // heading with NOTHING under it. The hard rule above says "if no price
    // book lines are provided, do not mention money at all" — but a heading
    // that exists and is empty is not the same as no heading, and this is the
    // one document that goes to a customer with money in it. State the
    // no-price case explicitly instead of leaving the model to interpret a
    // blank section.
    priceBookLines.length
      ? `PRICE BOOK (the only money figures permitted):\n${priceBookLines.join("\n")}`
      : "PRICE BOOK: EMPTY — none of the recommended solutions has a published rate. Write the proposal with NO figures, totals or ranges anywhere. In the Investment section say the scope is being priced and the next step is a short call to confirm it.",
    "",
    meetingNotes.length
      ? `MEETING / CALL NOTES (weigh these heavily — they reflect the actual conversation):\n${meetingNotes
          .map((n) => `- ${n}`)
          .join("\n")}`
      : "",
    "",
    "Next Steps must end with booking or continuing the conversation with AutomateIQ. Total length: 500-900 words.",
  ]
    .filter(Boolean)
    .join("\n");

  // effort "medium": proposals deserve more thought than a DM, less than
  // sonnet-5's deep-reasoning default.
  return (await aiComplete(system, prompt, 4000, { effort: "medium" })).trim();
}
