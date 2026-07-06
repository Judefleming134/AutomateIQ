/**
 * Lead scoring — the ONE place the qualification formula lives. Six criteria,
 * each rated 0–3 on the prospect record, roll up to a 0–100 lead score;
 * thresholds (editable in Settings) map the score to a qualification status.
 * Pure functions, safe on client and server.
 */

export const CRITERIA = [
  {
    key: "q_company_size",
    label: "Company size",
    options: ["Unknown / solo", "Small (2–10)", "Growing (11–50)", "Established (50+)"],
  },
  {
    key: "q_industry_fit",
    label: "Industry fit",
    options: ["Poor fit", "Some fit", "Good fit", "Excellent fit"],
  },
  {
    key: "q_budget",
    label: "Budget indicators",
    options: ["None", "Weak", "Moderate", "Strong"],
  },
  {
    key: "q_decision_maker",
    label: "Decision-maker status",
    options: ["Not a decision maker", "Influencer", "Shared decision", "Sole decision maker"],
  },
  {
    key: "q_pain_points",
    label: "Pain points",
    options: ["None identified", "Mild", "Clear", "Acute"],
  },
  {
    key: "q_timeline",
    label: "Timeline",
    options: ["No timeline", "6+ months", "1–3 months", "Ready now"],
  },
] as const;

export type CriterionKey = (typeof CRITERIA)[number]["key"];

export function computeLeadScore(
  ratings: Partial<Record<CriterionKey, number>>
): number {
  const max = CRITERIA.length * 3;
  const total = CRITERIA.reduce((sum, c) => {
    const v = ratings[c.key] ?? 0;
    return sum + Math.min(3, Math.max(0, v));
  }, 0);
  return Math.round((total / max) * 100);
}

/**
 * Score → status, unless the prospect was manually disqualified (that flag
 * always wins — re-scoring never resurrects a prospect someone ruled out).
 */
export function qualificationFromScore(
  score: number,
  thresholds: { qualifyThreshold: number; reviewThreshold: number },
  current?: string
): "qualified" | "in_review" | "unqualified" | "disqualified" {
  if (current === "disqualified") return "disqualified";
  if (score >= thresholds.qualifyThreshold) return "qualified";
  if (score >= thresholds.reviewThreshold) return "in_review";
  return "unqualified";
}
