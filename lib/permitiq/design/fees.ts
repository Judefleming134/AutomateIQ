/**
 * The planning application fee.
 *
 * A DATED CATALOG, NOT CONSTANTS — the same decision migration 0033 made for
 * pq_requirements, and for the same reason. Irish planning fees are set by
 * regulation (Schedule 9 of the Planning and Development Regulations 2001, as
 * amended) and they change by statutory instrument. A number compiled into a
 * release is a number that goes stale silently and gets a customer's
 * application returned for the wrong fee.
 *
 * So every rate carries `effectiveFrom` and a `source`, the calculation names
 * which entry it used, and the result carries a verify line that the UI is not
 * allowed to drop. This is the honest position: we do the arithmetic, which is
 * where people actually go wrong (floor area × rate versus the minimum, the
 * ×3 on retention), and we tell them to confirm the rate against the
 * authority's own published schedule, which is where the risk actually sits.
 *
 * NOT A FEE WAIVER ORACLE. Exemptions exist — social housing, certain
 * disability-related works, reduced fees for some classes — and they turn on
 * facts this product does not hold. `feeFor` never claims an exemption; it
 * lists them as questions to ask, which is the only honest thing a form-filler
 * can do about a discretionary relief.
 */

import type { DesignBrief, WorksType } from "./brief";
import { briefMetrics } from "./brief";

/** Which fee class in Schedule 9 the works fall into. */
export type FeeClass =
  | "dwelling"
  | "domestic_works"
  | "other_buildings"
  | "change_of_use";

export type FeeRate = {
  jurisdiction: "ie";
  feeClass: FeeClass;
  label: string;
  /** Flat amount in euro, when the class is a flat fee. */
  flatEur?: number;
  /** Per square metre of gross floor space, when the class is area-based. */
  perM2Eur?: number;
  /** Floor applied to an area-based class. */
  minimumEur?: number;
  /** Per dwelling, when the class counts units. */
  perUnitEur?: number;
  effectiveFrom: string;
  source: string;
};

/**
 * The seeded Irish rates.
 *
 * Kept in one exported array rather than a map so a later migration can lift
 * it into a table verbatim, and so `effectiveFrom` can carry more than one
 * generation of a rate without the lookup changing shape.
 */
export const IE_FEE_RATES: FeeRate[] = [
  {
    jurisdiction: "ie",
    feeClass: "dwelling",
    label: "Provision of a dwelling",
    perUnitEur: 65,
    effectiveFrom: "2001-01-01",
    source: "Planning and Development Regulations 2001, Schedule 9, Class 1",
  },
  {
    jurisdiction: "ie",
    feeClass: "domestic_works",
    label: "Extension, alteration or works incidental to the enjoyment of a house",
    flatEur: 34,
    effectiveFrom: "2001-01-01",
    source: "Planning and Development Regulations 2001, Schedule 9, Class 2",
  },
  {
    jurisdiction: "ie",
    feeClass: "other_buildings",
    label: "Buildings other than a dwelling or domestic works",
    perM2Eur: 3.6,
    minimumEur: 80,
    effectiveFrom: "2001-01-01",
    source: "Planning and Development Regulations 2001, Schedule 9, Class 4",
  },
  {
    jurisdiction: "ie",
    feeClass: "change_of_use",
    label: "Change of use",
    flatEur: 80,
    effectiveFrom: "2001-01-01",
    source: "Planning and Development Regulations 2001, Schedule 9",
  },
];

/** Which class a works type falls into. */
export function feeClassFor(works: WorksType): FeeClass {
  switch (works) {
    case "new_dwelling":
    case "demolition_and_rebuild":
      return "dwelling";
    case "extension":
    case "conversion":
    case "garage_outbuilding":
      return "domestic_works";
    case "change_of_use":
      return "change_of_use";
    default:
      return "other_buildings";
  }
}

/** The rate in force on `onDate` for a class. Newest effective wins. */
export function rateFor(feeClass: FeeClass, onDate: string): FeeRate | null {
  const candidates = IE_FEE_RATES.filter(
    (r) => r.feeClass === feeClass && r.effectiveFrom <= onDate
  ).sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
  return candidates[0] ?? null;
}

/** Multipliers that apply on top of the base fee. */
export const RETENTION_MULTIPLIER = 3;
export const OUTLINE_MULTIPLIER = 0.75;

export type FeeInput = {
  brief: DesignBrief;
  /** Matches pq_applications.application_type. */
  applicationType: "planning_permission" | "retention_permission" | "outline_permission";
  /** Dwellings proposed. Only counted for the dwelling class. */
  dwellingCount?: number;
  /** Fixed by the caller so the same application quotes the same fee. */
  onDate: string;
};

export type FeeLine = {
  label: string;
  amountEur: number;
  /** How this line was arrived at, in words. Shown, never hidden. */
  workingOut: string;
};

export type FeeResult = {
  feeClass: FeeClass;
  lines: FeeLine[];
  totalEur: number;
  rate: FeeRate | null;
  /** Reliefs we cannot decide, phrased as questions for the applicant. */
  questionsToAsk: string[];
  /** Never optional. The UI may not render a fee without it. */
  verifyNote: string;
};

const eur = (n: number) => Math.round(n * 100) / 100;

/**
 * Works the fee out, showing every step.
 *
 * The working-out is the product. Anyone can look up "€34"; what gets an
 * application returned is applying the minimum instead of the area rate,
 * forgetting that retention is charged at three times, or paying the full fee
 * on an outline application. Each of those is a line here with its arithmetic
 * written out, so the applicant can check it against the authority's schedule
 * in seconds rather than re-deriving it.
 */
export function feeFor(input: FeeInput): FeeResult {
  const feeClass = feeClassFor(input.brief.works);
  const rate = rateFor(feeClass, input.onDate);
  const m = briefMetrics(input.brief);
  const lines: FeeLine[] = [];

  if (!rate) {
    return {
      feeClass,
      lines: [],
      totalEur: 0,
      rate: null,
      questionsToAsk: [],
      verifyNote:
        "No fee rate on file for this class. Take the fee straight from the planning authority's published schedule.",
    };
  }

  let base = 0;
  if (rate.perUnitEur !== undefined) {
    const units = Math.max(1, input.dwellingCount ?? 1);
    base = rate.perUnitEur * units;
    lines.push({
      label: rate.label,
      amountEur: eur(base),
      workingOut: `€${rate.perUnitEur} per dwelling × ${units} dwelling${units === 1 ? "" : "s"}`,
    });
  } else if (rate.perM2Eur !== undefined) {
    const area = m.proposedFloorAreaM2;
    const byArea = rate.perM2Eur * area;
    const min = rate.minimumEur ?? 0;
    base = Math.max(byArea, min);
    lines.push({
      label: rate.label,
      amountEur: eur(base),
      // The comparison is written out because taking the wrong side of it is
      // the single most common way this class is got wrong.
      workingOut:
        `€${rate.perM2Eur}/m² × ${area}m² = €${eur(byArea)}; minimum €${min}. ` +
        `The greater applies, so €${eur(base)}.`,
    });
  } else {
    base = rate.flatEur ?? 0;
    lines.push({
      label: rate.label,
      amountEur: eur(base),
      workingOut: `Flat fee for this class`,
    });
  }

  let total = base;
  if (input.applicationType === "retention_permission") {
    const uplift = base * RETENTION_MULTIPLIER - base;
    total = base * RETENTION_MULTIPLIER;
    lines.push({
      label: "Retention uplift",
      amountEur: eur(uplift),
      workingOut: `Retention is charged at ${RETENTION_MULTIPLIER}× the normal fee: €${eur(base)} × ${RETENTION_MULTIPLIER} = €${eur(total)}`,
    });
  } else if (input.applicationType === "outline_permission") {
    const reduction = base - base * OUTLINE_MULTIPLIER;
    total = base * OUTLINE_MULTIPLIER;
    lines.push({
      label: "Outline permission reduction",
      amountEur: eur(-reduction),
      workingOut: `An outline application is charged at ${OUTLINE_MULTIPLIER * 100}% of the full fee`,
    });
  }

  const questionsToAsk = [
    "Is any fee exemption or reduction available for these works? Reliefs exist for certain social housing, disability-related and voluntary-body applications, and they turn on facts this form doesn't hold.",
    "Does the authority charge separately for anything else — for example a development contribution on grant, which is not part of this application fee?",
  ];
  if (feeClass === "other_buildings") {
    questionsToAsk.push(
      "Is the gross floor space measured the way the authority measures it? The rate is per m² of gross floor space, which can differ from the floor area on the drawings."
    );
  }

  return {
    feeClass,
    lines,
    totalEur: eur(total),
    rate,
    questionsToAsk,
    verifyNote:
      `Rate taken from ${rate.source}, effective ${rate.effectiveFrom}. ` +
      `Planning fees are set by regulation and change — confirm the current amount with the planning authority before paying. ` +
      `An application submitted with the wrong fee is invalid.`,
  };
}
