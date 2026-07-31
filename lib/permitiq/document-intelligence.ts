import "server-only";
import { aiComplete } from "@/lib/ai/complete";

/**
 * The Document Intelligence Agent.
 *
 * Reads an uploaded PDF or drawing and answers three questions: which
 * requirement is this, what's in it, and what looks wrong. It exists because
 * the alternative — the applicant hand-labelling twenty drawings — is the
 * tedium the product is sold to remove.
 *
 * It leans entirely on infrastructure that already existed: aiComplete takes a
 * base64 attachment with an application/pdf mime type on both the Anthropic and
 * Gemini paths, and enforces a JSON Schema server-side on the Claude path. So
 * this file is a prompt, a schema and a set of guard rails — not a document
 * pipeline.
 *
 * THE GUARD RAIL THAT MATTERS: the model may only choose a requirement code
 * from the list it is given, and anything it isn't sure about must come back
 * `unknown`. A confidently wrong attribution is worse than no attribution,
 * because buildChecklist() turns an attribution into a ticked box, and a ticked
 * box the applicant believes is how someone arrives at a council counter
 * missing a drawing.
 */

export type DocumentAnalysis = {
  /** A requirement code from the supplied list, or null when unsure. */
  requirementCode: string | null;
  /** Plain-English description of what the document actually is. */
  summary: string;
  /** Concrete problems: wrong scale, missing north arrow, undated notice. */
  issues: string[];
  /** The model's own confidence. Anything but "high" leaves it unattributed. */
  confidence: "high" | "medium" | "low";
};

const SCHEMA = {
  type: "object",
  properties: {
    requirement_code: {
      type: ["string", "null"],
      description:
        "The code of the requirement this document satisfies, chosen ONLY from the provided list. null if it does not clearly match one.",
    },
    summary: {
      type: "string",
      description: "One or two plain sentences: what this document actually is.",
    },
    issues: {
      type: "array",
      items: { type: "string" },
      description:
        "Concrete problems an assessor would flag. Empty array if none are visible.",
    },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
  required: ["requirement_code", "summary", "issues", "confidence"],
  additionalProperties: false,
} as const;

const SYSTEM = [
  "You are a planning-application document assessor for PermitIQ.",
  "You are shown ONE document from a planning or building permit application, plus the list of requirements that application must satisfy.",
  "",
  "Your job:",
  "1. Decide which ONE requirement code this document satisfies. You may only use a code from the list given to you. If it does not clearly match exactly one of them, return null.",
  "2. Describe in one or two plain sentences what the document actually is. Write for a homeowner, not a planner.",
  "3. List concrete problems an assessor would flag — a drawing with no scale bar or north arrow, a notice with no date, an unsigned form, a map with no site outline. Only things you can actually see. An empty list is a perfectly good answer.",
  "4. State your confidence.",
  "",
  "RULES YOU MUST NOT BREAK:",
  "- Never invent a requirement code. Only codes from the list.",
  "- If you are guessing, say null and set confidence low. A wrong match makes the applicant think a box is ticked when it is not, and they lose weeks at the council counter. Saying 'I am not sure' is always the better answer.",
  "- Do not claim a document is compliant. You describe and flag; you never approve.",
  "- Never state a requirement that is not in the list you were given.",
].join("\n");

/** Only these reach the model — the platform's own limits, not a guess. */
const SUPPORTED_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export function isAnalysableType(contentType: string | null | undefined): boolean {
  return SUPPORTED_TYPES.has((contentType ?? "").toLowerCase());
}

/**
 * Normalises whatever the model returned into something buildChecklist can
 * trust. Exported for testing — this is where a hallucinated code is caught.
 */
export function normaliseAnalysis(
  raw: unknown,
  allowedCodes: string[]
): DocumentAnalysis {
  const o = (raw ?? {}) as Record<string, unknown>;
  const allowed = new Set(allowedCodes);

  const rawCode =
    typeof o.requirement_code === "string" ? o.requirement_code.trim() : null;
  const confidence =
    o.confidence === "high" || o.confidence === "medium" || o.confidence === "low"
      ? o.confidence
      : "low";

  // Two independent reasons to refuse an attribution, and both must pass.
  // A code outside the list is a hallucination. A code the model itself isn't
  // confident about is a coin flip, and buildChecklist would render either as
  // a ticked box.
  const code =
    rawCode && allowed.has(rawCode) && confidence === "high" ? rawCode : null;

  const issues = Array.isArray(o.issues)
    ? o.issues.filter((i): i is string => typeof i === "string" && i.trim().length > 0).slice(0, 10)
    : [];

  return {
    requirementCode: code,
    summary:
      typeof o.summary === "string" && o.summary.trim()
        ? o.summary.trim().slice(0, 600)
        : "Could not read this document.",
    issues,
    confidence,
  };
}

/**
 * Analyses one document. Returns null on any failure — the upload has already
 * succeeded and the file is safe; analysis is an enhancement, and an applicant
 * losing their document because a model call timed out would be indefensible.
 */
export async function analyseDocument(params: {
  fileBase64: string;
  contentType: string;
  fileName: string;
  requirements: { code: string; label: string; guidance: string | null }[];
}): Promise<DocumentAnalysis | null> {
  if (!isAnalysableType(params.contentType)) return null;
  if (params.requirements.length === 0) return null;

  const list = params.requirements
    .map((r) => `- ${r.code}: ${r.label}${r.guidance ? ` — ${r.guidance}` : ""}`)
    .join("\n");

  const prompt = [
    `Document filename: ${params.fileName}`,
    "",
    "Requirements this application must satisfy (choose at most ONE code from here):",
    list,
    "",
    "Assess the attached document against that list.",
  ].join("\n");

  try {
    const text = await aiComplete(SYSTEM, prompt, 1200, {
      json: true,
      schema: SCHEMA as unknown as Record<string, unknown>,
      // Reading a drawing is a judgement call, not a rewrite.
      effort: "medium",
      // The upload round-trip already spent part of the budget.
      timeoutMs: 40_000,
      attachment: {
        mimeType: params.contentType,
        dataBase64: params.fileBase64,
      },
    });
    return normaliseAnalysis(JSON.parse(text), params.requirements.map((r) => r.code));
  } catch {
    // Swallowed deliberately: the document is stored, the checklist still
    // works by hand, and the applicant can re-run the analysis.
    return null;
  }
}
