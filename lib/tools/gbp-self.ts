import {
  buildGbpReport,
  noProfileReport,
  type GbpProfile,
  type GbpResult,
} from "@/lib/tools/gbp-report";

/**
 * The Google Business Profile checker, WITHOUT the Google API key.
 *
 * J1 had this tool switched off waiting on a Google Cloud billing account. The
 * Places API was only ever doing data entry — it read seven facts off a public
 * profile. Every one of those facts is visible to the owner in about sixty
 * seconds, and the part with the actual value (what each one costs you, what
 * to do about it, in what order) was ours the whole time.
 *
 * So this asks. Seven questions, all multiple choice, no typing except the
 * business name — then the SAME scoring engine, the same findings, the same
 * verdict, the same lead capture. It runs in the browser: no API call, no key,
 * no per-check cost, nothing to rate-limit.
 *
 * Three things it does BETTER than the paid path, not just cheaper:
 *
 *   1. It works for a business with no profile at all. Places returns
 *      "not found" for those — so the paid tool had nothing to say to exactly
 *      the person with the most to gain from hearing it.
 *   2. Answering the questions is the audit. Somebody who clicks through
 *      "is your category set? — I don't know" has just learned something,
 *      before a single result renders.
 *   3. It never invents precision. A bucketed answer is reported as the
 *      bucket ("8–24 reviews"), never as a made-up exact number.
 *
 * The trade is real and worth stating: these are self-declared, so the report
 * says so on screen. If the key is ever set, `lib/tools/gbp.ts` takes over and
 * produces the same shape from Google's own data.
 */

export type SelfOption = { value: string; label: string };
export type SelfQuestion = {
  id: SelfField;
  question: string;
  /** The bit that turns a form into a lesson. Shown under the question. */
  hint?: string;
  options: SelfOption[];
};

export type SelfField =
  | "hasProfile"
  | "reviews"
  | "rating"
  | "hours"
  | "phone"
  | "website"
  | "category"
  | "description";

export type SelfAnswers = Partial<Record<SelfField, string>> & { name?: string };

/** Where to look, said once, so the questions are answerable rather than guessed. */
export const SELF_LOOKUP_HINT =
  "Search your business name on Google on your phone — your profile is the panel that appears on the right, or at the top on mobile. Everything below is on it.";

/**
 * Buckets, not numbers.
 *
 * Nobody knows they have 23 reviews. They know they have "a few". The
 * boundaries are placed on the thresholds the scorer already uses (8 and 25),
 * so a bucket maps to a status without any rounding judgement — and the
 * representative value is the BOTTOM of each bucket, so the score is never
 * flattered by the answer being vague.
 */
const REVIEW_BUCKETS: Record<string, { count: number; label: string }> = {
  none: { count: 0, label: "No reviews yet" },
  few: { count: 1, label: "Somewhere between 1 and 7 reviews" },
  some: { count: 8, label: "Somewhere between 8 and 24 reviews" },
  many: { count: 25, label: "25 or more reviews" },
  unknown: { count: 0, label: "You weren't sure how many reviews you have" },
};

const RATING_BUCKETS: Record<string, { rating: number | null; label: string }> = {
  none: { rating: null, label: "No star rating yet" },
  low: { rating: 3.5, label: "Under 4.0 out of 5" },
  mid: { rating: 4.0, label: "Between 4.0 and 4.4 out of 5" },
  high: { rating: 4.5, label: "4.5 out of 5 or better" },
  unknown: { rating: null, label: "You weren't sure of your rating" },
};

export const SELF_QUESTIONS: SelfQuestion[] = [
  {
    id: "hasProfile",
    question: "Have you got a Google Business Profile?",
    hint: "The free listing that puts you on the map with your reviews and opening hours. Not your website.",
    options: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
      { value: "unsure", label: "Not sure" },
    ],
  },
  {
    id: "reviews",
    question: "Roughly how many Google reviews have you got?",
    hint: "The number beside the stars. A rough band is fine.",
    options: [
      { value: "none", label: "None yet" },
      { value: "few", label: "1–7" },
      { value: "some", label: "8–24" },
      { value: "many", label: "25 or more" },
      { value: "unknown", label: "Not sure" },
    ],
  },
  {
    id: "rating",
    question: "What's your star rating?",
    options: [
      { value: "none", label: "No rating yet" },
      { value: "low", label: "Under 4.0" },
      { value: "mid", label: "4.0 – 4.4" },
      { value: "high", label: "4.5 or better" },
      { value: "unknown", label: "Not sure" },
    ],
  },
  {
    id: "hours",
    question: "Are your opening hours on it?",
    hint: "If they are, the profile shows 'Open now' or 'Closed' in green or red.",
    options: [
      { value: "yes", label: "Yes, all set" },
      { value: "no", label: "No / I don't think so" },
    ],
  },
  {
    id: "phone",
    question: "Is your phone number on it?",
    hint: "There'd be a Call button.",
    options: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
    ],
  },
  {
    id: "website",
    question: "Is your website linked from it?",
    options: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No, but I have a website" },
      { value: "none", label: "I haven't got a website" },
    ],
  },
  {
    id: "category",
    question: "Is a business category set?",
    hint: "The grey text under your name — 'Plumber', 'Electrician', 'Roofing contractor'.",
    options: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
      { value: "unsure", label: "Not sure" },
    ],
  },
  {
    id: "description",
    question: "Have you written the business description?",
    hint: "The paragraph about what you do. Most profiles have it blank.",
    options: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No / not sure" },
    ],
  },
];

/** The questions that are only worth asking once there IS a profile. */
export const PROFILE_QUESTIONS = SELF_QUESTIONS.filter((q) => q.id !== "hasProfile");

/** Every question answered? The form won't submit until this is true. */
export function isComplete(a: SelfAnswers): boolean {
  if (!a.hasProfile) return false;
  if (a.hasProfile !== "yes") return true; // nothing else applies
  return PROFILE_QUESTIONS.every((q) => Boolean(a[q.id]));
}

/**
 * Turn the answers into a report.
 *
 * "Not sure" is deliberately scored as NOT set, everywhere it appears. That
 * looks harsh, and it is the honest reading: if the owner can't tell you their
 * category is right, they have not checked it, and an unchecked category is
 * the single most common reason a real trade never enters the running. Scoring
 * a shrug as a pass would hand back a comfortable number and teach nothing —
 * and the fix text for each one says exactly how to go and look.
 */
export function scoreSelfCheck(answers: SelfAnswers): GbpResult {
  const name = (answers.name ?? "").trim().slice(0, 120);

  if (answers.hasProfile !== "yes") return noProfileReport(name);

  const reviews = REVIEW_BUCKETS[answers.reviews ?? "unknown"] ?? REVIEW_BUCKETS.unknown;
  const rating = RATING_BUCKETS[answers.rating ?? "unknown"] ?? RATING_BUCKETS.unknown;

  const profile: GbpProfile = {
    name: name || "Your business",
    address: "",
    rating: rating.rating,
    ratingLabel: rating.label,
    reviewCount: reviews.count,
    reviewCountLabel: reviews.label,
    // "Not sure" is not a yes.
    primaryType: answers.category === "yes" ? "Set" : null,
    mapsUri: null,
    phone: answers.phone === "yes" ? "On the profile" : null,
    website: answers.website === "yes" ? "Linked" : null,
    hoursListed: answers.hours === "yes",
    hoursDays: null,
    descriptionWritten: answers.description === "yes",
    businessStatus: null,
    source: "self",
  };

  const report = buildGbpReport(profile);

  // One substitution the generic engine can't make: "no website linked" and
  // "hasn't got a website" are different problems with different fixes, and
  // telling someone to link a site they don't have is the kind of wrong advice
  // that loses the reader.
  if (answers.website === "none") {
    const site = report.findings.find((f) => f.id === "website");
    if (site) {
      site.found = "You said you haven't got a website";
      site.fix =
        "The profile is carrying the whole thing on its own, which it can do — plenty of trades run on it alone. But you own nothing on it: Google decides what it shows and can suspend it without warning. A one-page site is the cheap insurance.";
    }
  }

  return report;
}
