/**
 * THE PRICE BOOK — the single source of truth for every figure the Growth
 * Engine shows or says about money. The AI never invents prices; it only
 * quotes these. Edit the numbers HERE and every recommendation card,
 * proposal and pricing answer updates together.
 *
 * These are deliberate FOUNDING-CUSTOMER rates for the first customers:
 * priced to be an easy yes for an Irish SME (a single saved job usually
 * covers the month), well under typical agency rates, with margin over
 * hosting/AI costs. Raise them as the case studies stack up — the
 * "founding rate" framing makes later increases natural.
 */

export type PriceEntry = {
  /** One-off setup / build fee in EUR. */
  setup: number;
  /** Monthly fee in EUR (0 = project-only). */
  monthly: number;
  /** "from" pricing — final figure depends on scope. */
  from?: boolean;
};

export const PRICE_BOOK: Record<string, PriceEntry> = {
  "review-agent": { setup: 99, monthly: 49 },
  "speed-to-lead": { setup: 99, monthly: 49 },
  "ai-assistant": { setup: 149, monthly: 59 },
  "instant-quote-agent": { setup: 199, monthly: 79 },
  "website-lead-capture": { setup: 449, monthly: 29 },
  "ai-receptionist": { setup: 249, monthly: 129 },
  "voice-ai": { setup: 299, monthly: 149 },
  "workforce-management": { setup: 499, monthly: 99, from: true },
  "asset-management": { setup: 499, monthly: 99, from: true },
  "hsc-compliance": { setup: 499, monthly: 99, from: true },
  "finance-invoice-automation": { setup: 399, monthly: 99, from: true },
  "business-operations-platform": { setup: 999, monthly: 199, from: true },
  "erp-platform": { setup: 1999, monthly: 249, from: true },
  "ai-logistics": { setup: 1999, monthly: 249, from: true },
  "bespoke-ai-software": { setup: 1500, monthly: 0, from: true },
};

const euro = (n: number) => `€${n.toLocaleString("en-IE")}`;

/** "€249 setup + €129/mo" / "from €1,500 (project)" — for cards and prompts. */
export function formatPrice(key: string): string | null {
  const p = PRICE_BOOK[key];
  if (!p) return null;
  const prefix = p.from ? "from " : "";
  if (p.monthly === 0) return `${prefix}${euro(p.setup)} (project, scoped)`;
  return `${prefix}${euro(p.setup)} setup + ${euro(p.monthly)}/mo`;
}

/**
 * Conservative first-year value of a set of recommendations — used to give
 * pipeline_value a grounded default after research (top two solutions
 * only; deals rarely start with more).
 */
export function estimatedFirstYearValue(keys: string[]): number {
  return keys
    .slice(0, 2)
    .reduce((sum, key) => {
      const p = PRICE_BOOK[key];
      return p ? sum + p.setup + p.monthly * 12 : sum;
    }, 0);
}

/** Pricing lines for AI prompts — the ONLY money figures the model may use. */
export function pricingLines(keys: string[]): string[] {
  return keys
    .map((key) => {
      const price = formatPrice(key);
      return price ? `- ${key}: ${price} (founding-customer rate)` : null;
    })
    .filter((l): l is string => l !== null);
}
