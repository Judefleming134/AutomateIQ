/**
 * Public product pages — the marketing side of the vertical products.
 *
 * These exist because `/tradeiq`, `/finance` and `/portal/permitiq` are all
 * behind a login. That is correct for a product, and useless on a business
 * card: the URL Jude says out loud on a call landed a stranger on a password
 * box with no explanation of what they were logging in to.
 *
 * Each page carries BOTH doors, which is the whole point of the exercise:
 * an existing customer signs in, and a new one requests access. A page with
 * only one of those turns half its visitors away.
 *
 * Content lives here rather than inside the page components so the three pages
 * share one layout and adding a fourth product is a data entry, not a new page.
 */

export type MarketingProduct = {
  slug: string;
  name: string;
  /** Shown above the headline. */
  kicker: string;
  headline: string;
  sub: string;
  /** Who it's actually for — plain, no personas. */
  who: string;
  /** What it does. Each one a concrete capability, not a benefit adjective. */
  does: { title: string; body: string }[];
  /** Where an existing customer signs in. */
  loginHref: string;
  /** Sent to /api/lead so a request from this page is attributable. */
  leadSource: string;
  /** True when the product is live; false shows an honest "in build" note. */
  live: boolean;
  accent: string;
};

export const MARKETING_PRODUCTS: MarketingProduct[] = [
  {
    slug: "tradeiq",
    name: "TradeIQ",
    kicker: "For trades & service businesses",
    headline: "Run the whole job from one place.",
    sub: "Quotes, invoices, customers and jobs on one system — with the phone answered while you're on the tools.",
    who: "Plumbers, electricians, builders, HVAC and any service business where the work happens away from a desk.",
    does: [
      {
        title: "Quote on the spot",
        body: "Turn a job description into a priced, itemised quote and send it before you leave the driveway. The customer can accept it online.",
      },
      {
        title: "Invoice and get paid",
        body: "Quotes become invoices in one step, with online card payment on the link. Chasing is automatic rather than a job for a Sunday evening.",
      },
      {
        title: "Every customer and job in one record",
        body: "No more scrolling WhatsApp for an address. One record per customer, one per job, and both stay up to date on their own.",
      },
      {
        title: "The phone answered when you can't",
        body: "ReceptionIQ takes the call, captures the job and puts it in the system — so a missed call stops being a lost job.",
      },
    ],
    loginHref: "/tradeiq/login",
    leadSource: "product-tradeiq",
    live: true,
    accent: "#EA580C",
  },
  {
    slug: "financeiq",
    name: "FinanceIQ",
    kicker: "For the money side",
    headline: "Know where the money is, without the spreadsheet.",
    sub: "Bank position, receivables, budgets and forecasting — with supplier invoices read and filed instead of typed.",
    who: "Any business past the point where the bank balance and a gut feeling are enough, and not yet at the point of hiring a finance team.",
    does: [
      {
        title: "Scan a supplier invoice",
        body: "Photograph it and it is read, categorised and filed against the right supplier. No manual entry, no shoebox in January.",
      },
      {
        title: "See what you're actually owed",
        body: "Receivables in one list, oldest first, with the chase already written. The number that matters most is the one nobody has time to compile.",
      },
      {
        title: "Budgets that update themselves",
        body: "Set a budget per category and watch it against real spend, rather than finding out at the year end.",
      },
      {
        title: "Forecast from real data",
        body: "Built off your actual invoices and costs, not an optimistic guess typed into a spreadsheet once.",
      },
    ],
    loginHref: "/finance/login",
    leadSource: "product-financeiq",
    live: true,
    accent: "#34D399",
  },
  {
    slug: "reputationiq",
    name: "ReputationIQ",
    kicker: "For any business that lives on its rating",
    headline: "Turn finished jobs into the reviews people search for.",
    sub: "Ask every customer for a review the day the job ends, chase the ones who forget, and see which asks actually landed — without anyone remembering to do it.",
    who: "Trades, salons, garages, restaurants, clinics — any business where the next customer reads the reviews before they ring.",
    does: [
      {
        title: "Ask while the job is still fresh",
        body: "Send the request the day you finish, when goodwill is at its highest. One customer, one link, one tap — no app for them to install and no account to make.",
      },
      {
        title: "One reminder, sent automatically",
        body: "Most people mean to and forget. A single follow-up goes out on its own if they haven't left one — exactly one, never a duplicate, and never after they've already reviewed you.",
      },
      {
        title: "Straight to the platform you actually use",
        body: "Google, Trustpilot, Facebook, Checkatrade, TrustATrader, RatedPeople, Houzz, TripAdvisor, Yelp and more. Paste your review link once and every request points at it.",
      },
      {
        title: "See what's working",
        body: "Requests sent, reminders, and how many were actually clicked — so 'we ask for reviews' becomes a number instead of a hope.",
      },
    ],
    loginHref: "/login",
    leadSource: "product-reputationiq",
    live: true,
    accent: "#7C3AED",
  },
  {
    slug: "permitiq",
    name: "PermitIQ",
    kicker: "For architects, engineers & developers",
    headline: "Know what's missing before the council does.",
    sub: "Upload the drawings and reports for a planning application, and get a checklist, a plain-English summary and the gaps — before you submit.",
    who: "Architects, engineers, planning consultants, developers and contractors putting applications in front of an Irish planning authority.",
    does: [
      {
        title: "Every document read",
        body: "Upload a drawing or report and it is read, described in plain English, and matched to the requirement it satisfies. Problems an assessor would flag — no scale bar, an undated notice — are called out.",
      },
      {
        title: "A checklist against the real requirements",
        body: "The national baseline plus anything your specific planning authority asks for on top, resolved into one list with nothing duplicated.",
      },
      {
        title: "An honest 'ready to submit'",
        body: "Anything unclear blocks it. We would rather tell you to check one more drawing than tell you you're finished and be wrong.",
      },
      {
        title: "A full audit history",
        body: "Every upload, reclassification and review recorded and unchangeable — so you can show exactly what was submitted and when.",
      },
    ],
    loginHref: "/login",
    leadSource: "product-permitiq",
    live: true,
    accent: "#0EA5E9",
  },
];

export function getMarketingProduct(slug: string): MarketingProduct | undefined {
  return MARKETING_PRODUCTS.find((p) => p.slug === slug);
}

/** Lead sources these pages are allowed to submit. Validated server-side. */
export const MARKETING_LEAD_SOURCES = MARKETING_PRODUCTS.map((p) => p.leadSource);

/** The source stored for a request that names no product. */
export const DEFAULT_LEAD_SOURCE = "automateiq-landing";

/**
 * Resolve the `source` field posted to /api/lead.
 *
 * Allow-listed rather than free text: `source` is the field the leads list is
 * filtered and counted by, so letting a public endpoint write arbitrary
 * strings into it would poison the one dimension that says which product is
 * actually selling. Anything unrecognised falls back to the landing-page
 * source — a lead is never dropped over its label.
 */
export function resolveLeadSource(raw: unknown): {
  source: string;
  productName: string | null;
} {
  const value = typeof raw === "string" ? raw.trim() : "";
  const product = MARKETING_PRODUCTS.find((p) => p.leadSource === value);
  if (!product) return { source: DEFAULT_LEAD_SOURCE, productName: null };
  return { source: product.leadSource, productName: product.name };
}
