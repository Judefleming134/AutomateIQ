import "server-only";
import { aiComplete } from "@/lib/ai/complete";
import type { ChecklistItem, ChecklistSummary } from "@/lib/permitiq/checklist";

/**
 * The Application Review Agent.
 *
 * Document Intelligence reads ONE file. This reads the whole application: what
 * is being proposed, what state it's in, and what an assessor would push back
 * on. It's the output a planning officer would skim first and the thing an
 * architect would paste into a covering letter.
 *
 * It is deliberately built on facts the platform already computed rather than
 * on the model re-deriving them. The checklist is arithmetic — which mandatory
 * items have evidence — and arithmetic must not be delegated to a language
 * model that might round it. So the model is TOLD the counts and told not to
 * contradict them; its job is judgement and prose, not counting.
 */

export type RiskFlag = {
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
};

export type ApplicationReview = {
  summary: string;
  riskFlags: RiskFlag[];
  /** What the applicant should do next, in order. */
  nextSteps: string[];
};

const SCHEMA = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      description:
        "3-5 plain sentences: what is being proposed, where, and the overall state of the application.",
    },
    risk_flags: {
      type: "array",
      items: {
        type: "object",
        properties: {
          severity: { type: "string", enum: ["high", "medium", "low"] },
          title: { type: "string" },
          detail: { type: "string" },
        },
        required: ["severity", "title", "detail"],
        additionalProperties: false,
      },
    },
    next_steps: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "risk_flags", "next_steps"],
  additionalProperties: false,
} as const;

const SYSTEM = [
  "You are a senior planning consultant reviewing an application before it is submitted.",
  "You are given the application details, the requirement checklist with its current state, and what was read out of each uploaded document.",
  "",
  "Produce three things:",
  "1. SUMMARY — 3 to 5 plain sentences. What is being proposed, where, and honestly what state the application is in. Write for the applicant, not for a planner.",
  "2. RISK FLAGS — what an assessor would push back on. A missing mandatory document is a high risk. A drawing with no scale bar is a medium. Something merely worth double-checking is low. Ground every flag in the material you were given.",
  "3. NEXT STEPS — the specific things to do next, most important first.",
  "",
  "RULES YOU MUST NOT BREAK:",
  "- The checklist counts you are given are FACTS. Never contradict them, never recount them, never say an application is complete when items are outstanding.",
  "- Never say the application will be approved, is compliant, or will succeed. You are not the planning authority and cannot promise an outcome.",
  "- Do not invent requirements. Only refer to items in the checklist you were shown.",
  "- If a document was not read successfully, say the gap is unverified rather than assuming it is fine.",
  "- Plain English. No planning jargon unless the checklist itself uses it.",
].join("\n");

/** Caps so one runaway response can't fill a page or a database row. */
const MAX_FLAGS = 12;
const MAX_STEPS = 8;

export function normaliseReview(raw: unknown): ApplicationReview {
  const o = (raw ?? {}) as Record<string, unknown>;

  const flags: RiskFlag[] = Array.isArray(o.risk_flags)
    ? (o.risk_flags as unknown[])
        .map((f) => {
          const r = (f ?? {}) as Record<string, unknown>;
          const severity =
            r.severity === "high" || r.severity === "medium" || r.severity === "low"
              ? r.severity
              : "low";
          const title = typeof r.title === "string" ? r.title.trim() : "";
          const detail = typeof r.detail === "string" ? r.detail.trim() : "";
          return title ? { severity, title: title.slice(0, 160), detail: detail.slice(0, 600) } : null;
        })
        .filter((f): f is RiskFlag => f !== null)
        // High risks first — a missing mandatory document must not sit below a
        // "consider double-checking the north arrow".
        .sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
        .slice(0, MAX_FLAGS)
    : [];

  const nextSteps = Array.isArray(o.next_steps)
    ? (o.next_steps as unknown[])
        .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
        .map((s) => s.trim().slice(0, 300))
        .slice(0, MAX_STEPS)
    : [];

  return {
    summary:
      typeof o.summary === "string" && o.summary.trim()
        ? o.summary.trim().slice(0, 2000)
        : "Could not produce a summary for this application.",
    riskFlags: flags,
    nextSteps,
  };
}

function severityRank(s: RiskFlag["severity"]): number {
  return s === "high" ? 0 : s === "medium" ? 1 : 2;
}

/**
 * The facts block handed to the model.
 *
 * Separated out and exported so it can be tested directly: the guarantee that
 * matters is that the model is never left to infer whether the application is
 * complete. If this block is wrong, the summary is wrong no matter how good
 * the prompt is.
 */
export function buildFactsBlock(input: {
  applicationType: string;
  jurisdiction: string;
  authority: string | null;
  siteAddress: string | null;
  checklist: ChecklistItem[];
  summary: ChecklistSummary;
  documents: { name: string; summary?: string; issues?: string[] }[];
}): string {
  const lines: string[] = [
    `Application type: ${input.applicationType.replace(/_/g, " ")}`,
    `Jurisdiction: ${input.jurisdiction === "us" ? "United States" : "Ireland"}`,
    `Planning authority: ${input.authority ?? "not specified — national requirements apply"}`,
    `Site: ${input.siteAddress ?? "not given"}`,
    "",
    "CHECKLIST STATE — these numbers are facts, do not recount them:",
    `- ${input.summary.total} requirements apply`,
    `- ${input.summary.satisfied} have evidence attached`,
    `- ${input.summary.missingMandatory} MANDATORY items are missing`,
    `- ${input.summary.unclear} items are unclear and need confirming`,
    `- Ready to submit: ${input.summary.readyToSubmit ? "yes" : "NO"}`,
    "",
    "ITEM BY ITEM:",
  ];

  for (const item of input.checklist) {
    lines.push(
      `- [${item.status.toUpperCase()}]${item.mandatory ? " (required)" : " (if it applies)"} ${item.label} — ${item.reason}`
    );
  }

  lines.push("", "DOCUMENTS UPLOADED:");
  if (input.documents.length === 0) {
    lines.push("- none");
  } else {
    for (const d of input.documents) {
      lines.push(`- ${d.name}${d.summary ? `: ${d.summary}` : " (not read)"}`);
      for (const issue of d.issues ?? []) lines.push(`    · issue found: ${issue}`);
    }
  }

  return lines.join("\n");
}

/** Returns null on any failure — a review is an enhancement, never a blocker. */
export async function reviewApplication(input: Parameters<typeof buildFactsBlock>[0]): Promise<ApplicationReview | null> {
  try {
    const text = await aiComplete(SYSTEM, buildFactsBlock(input), 2000, {
      json: true,
      schema: SCHEMA as unknown as Record<string, unknown>,
      effort: "medium",
      timeoutMs: 45_000,
    });
    return normaliseReview(JSON.parse(text));
  } catch {
    return null;
  }
}
