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
  const system = [
    "You write commercial proposals for AutomateIQ, an Irish AI-automation agency (automateiq.ie).",
    "Audience: the business owner. Voice: clear, confident, jargon-free, professional.",
    "HARD RULES:",
    "- Ground everything in the provided research and notes. Never invent client names, revenue figures or specifics. Where a detail must be confirmed, write it as a bracketed placeholder like [confirm current call volume].",
    "- All operational-benefit statements are ILLUSTRATIVE estimates, clearly framed as such — never guarantees.",
    "- PRICING: use ONLY the founding-customer rates in the PRICE BOOK lines below — never any other figure. Present them as an 'Investment' line per recommended solution, framed as founding-customer rates: available to AutomateIQ's first 10 customers only, locked for the first year, subject to final scope. If no price book lines are provided, do not mention money at all.",
    "Output ONLY the proposal as clean Markdown. Use ## for section headings.",
  ].join("\n");

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
    report?.overview
      ? [
          "RESEARCH:",
          `- Overview: ${report.overview}`,
          `- Business model: ${report.business_model}`,
          report.services.length ? `- Services: ${report.services.join("; ")}` : "",
          report.manual_processes.length
            ? `- Likely manual processes: ${report.manual_processes.join("; ")}`
            : "",
          report.inefficiencies.length
            ? `- Likely inefficiencies: ${report.inefficiencies.join("; ")}`
            : "",
          report.proposal_angle ? `- Strongest angle: ${report.proposal_angle}` : "",
        ]
          .filter(Boolean)
          .join("\n")
      : "RESEARCH: none on file — keep the overview and challenges general and hedged.",
    "",
    solutions.length
      ? `RECOMMENDED SOLUTIONS (structure the two recommendation sections around these):\n${solutions
          .map((s) => `- ${s.name} (${s.complexity} complexity): ${s.why} Illustrative benefits: ${s.benefits}`)
          .join("\n")}`
      : "RECOMMENDED SOLUTIONS: none saved — propose the most plausible AutomateIQ fits, hedged.",
    "",
    solutions.length
      ? `PRICE BOOK (the only money figures permitted):\n${pricingLines(
          solutions.map((s) => s.key)
        ).join("\n")}`
      : "",
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
