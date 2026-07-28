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
  "ai-receptionist": { setup: 349, monthly: 129 },
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
 *
 * Order matters and must match buildQuote: filter to PRICED solutions FIRST,
 * then take two. Slicing first meant an unpriced catalogue entry at the top of
 * the recommendations consumed one of the two slots and contributed nothing —
 * so the pipeline showed the value of ONE solution while the quote panel and
 * the call sheet quoted TWO (measured: €687 vs €2,584 on the same prospect).
 */
export function estimatedFirstYearValue(keys: string[]): number {
  return keys
    .filter((key) => PRICE_BOOK[key])
    .slice(0, 2)
    .reduce((sum, key) => {
      const p = PRICE_BOOK[key];
      return sum + p.setup + p.monthly * 12;
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

/**
 * The founding offer, stated once so every screen and prompt says the same
 * thing: price-book rates locked for the first 10 customers.
 */
export const FOUNDING_OFFER =
  "Founding offer — these rates are locked in for our first 10 customers only, then they rise.";

export type Quote = {
  lines: { key: string; name: string; setup: number; monthly: number; from: boolean }[];
  setupTotal: number;
  monthlyTotal: number;
  firstYear: number;
  /** True when any line is "from" pricing — totals are minimums. */
  hasFrom: boolean;
};

/**
 * THE quote for a company: its top two priced recommendations packaged into
 * one figure to say out loud — setup total, monthly total, first-year value.
 * Deterministic price-book maths (matches estimatedFirstYearValue), so the
 * quote can never contradict the pipeline number or the proposal.
 */
export function buildQuote(
  recommendations: { key: string; name: string }[]
): Quote | null {
  const lines = recommendations
    .filter((r) => PRICE_BOOK[r.key])
    .slice(0, 2)
    .map((r) => {
      const p = PRICE_BOOK[r.key];
      return {
        key: r.key,
        name: r.name,
        setup: p.setup,
        monthly: p.monthly,
        from: Boolean(p.from),
      };
    });
  if (lines.length === 0) return null;
  const setupTotal = lines.reduce((s, l) => s + l.setup, 0);
  const monthlyTotal = lines.reduce((s, l) => s + l.monthly, 0);
  return {
    lines,
    setupTotal,
    monthlyTotal,
    firstYear: setupTotal + monthlyTotal * 12,
    hasFrom: lines.some((l) => l.from),
  };
}

export const formatEuro = euro;
