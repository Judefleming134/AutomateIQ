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
  /**
   * Which half of the range this belongs to.
   *
   * "industry" — solves one trade's problem (TradeIQ, FinanceIQ, PlanIQ,
   *   ReputationIQ). The question a visitor asks is "is this for me?".
   * "core" — works whatever you run (AssistIQ, SiteIQ, ContentIQ). The
   *   question is "what else do I get?".
   * "module" — one job done properly, switchable on its own (QuoteIQ,
   *   ClientIQ, LeadIQ, CustomIQ). Three of these are the pieces TradeIQ is
   *   assembled from and CustomIQ is the bespoke door; each is nonetheless a
   *   separate entitlement in `business_products`, so a customer really can
   *   buy one without the rest. The question is "can I just have that bit?".
   *
   * The index used to render all seven as one flat list, which contradicted
   * its own hero ("start with the core and switch on what your industry
   * needs") and left a lone card stranded on a third row of a 3-column grid —
   * the exact orphan the free-tools hub already had to fix once.
   */
  group: "industry" | "core" | "module";
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
        title: "Invoice and chase it for you",
        // ONLY WHAT /i/[token] AND lib/cron/invoice-chaser.ts ACTUALLY DO.
        //
        // This used to promise "online card payment on the link". Nothing in
        // the codebase takes a card: the public invoice page states the amount
        // owed and says to pay "using the details {business} gave you, quoting
        // {number}", and app/tradeiq/actions.ts answers any attempt with
        // "Online payment isn't switched on yet". A prospect who buys on that
        // sentence discovers it is false the first time they send an invoice —
        // and while there is one customer, that customer is also the only
        // reference, so it is the one lie there is no recovering from.
        //
        // Everything kept here is real and verifiable: quote → invoice in one
        // step, a per-invoice link (which shows a part payment, so nobody pays
        // twice), and the escalating automatic reminders the 07:00 chaser
        // sends. See lib/products/unbacked-claims.test.ts.
        body: "Quotes become invoices in one step, each with its own link showing exactly what's owed — part payments included, so nobody pays twice. Overdue reminders go out on their own rather than being a job for a Sunday evening.",
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
    group: "industry",
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
    group: "industry",
  },
  {
    slug: "assistiq",
    name: "AssistIQ",
    kicker: "For everyone — the layer that runs the rest",
    headline: "Ask for the work, don't go looking for it.",
    sub: "One assistant that knows your business and actually operates the other products on your account — so you say what you want done instead of finding the screen that does it.",
    who: "Every AutomateIQ customer. It's the front door to whatever else you have switched on.",
    does: [
      {
        title: "It does the job, not a tutorial",
        body: "Ask it to send a review request or write this month's offer and it goes and does it through the products on your account. It tells you plainly what it did afterwards.",
      },
      {
        title: "It knows your business",
        body: "Fill in the knowledge panel once — services, prices, area, hours — and every answer and every piece of writing uses it. Set the tone and it keeps to it.",
      },
      {
        title: "It won't make things up",
        body: "Hard rule: never invent a price, a service or a policy that isn't in your business information. If it doesn't know, it says so and asks.",
      },
      {
        title: "It won't act on half an instruction",
        body: "Before anything reaches a real customer it checks it has what it needs — a name AND an email for a review request, never a guessed address.",
      },
    ],
    loginHref: "/login",
    leadSource: "product-assistiq",
    live: true,
    accent: "#22D3EE",
    group: "core",
  },
  {
    slug: "siteiq",
    name: "SiteIQ",
    kicker: "For anyone whose website is a business card",
    headline: "A page that works, live today.",
    sub: "A hosted page with what you do, where you work and how to reach you — and an enquiry form whose leads land in your account instead of an inbox you forget to check.",
    who: "Businesses with no website, or one so old it's costing them work. Also anyone who wants a fast page for one service or one area.",
    does: [
      {
        title: "Live on your own address",
        body: "Pick your name and the page is published at automateiq.ie/b/yourname. Change the headline, what you do, your services or your number and it updates immediately.",
      },
      {
        title: "Enquiries land in the system",
        body: "The form on the page writes straight into your leads list — visible in the portal, not sitting in a personal inbox behind a phone screen.",
      },
      {
        title: "On and off in one click",
        body: "Publish when you're ready, unpublish while you rewrite it. Nothing goes public until you say so.",
      },
      {
        title: "Written for you if you want",
        body: "AssistIQ and ContentIQ can write the page copy in your voice from what they already know about the business.",
      },
    ],
    loginHref: "/login",
    leadSource: "product-siteiq",
    live: true,
    accent: "#3B82F6",
    group: "core",
  },
  {
    slug: "contentiq",
    name: "ContentIQ",
    kicker: "For the marketing nobody has time for",
    headline: "The posts, emails and ads you keep meaning to write.",
    sub: "Blogs, social posts, marketing emails and ad copy — written in your voice, from what the system already knows about your business, ready to publish.",
    who: "Any business that knows it should be posting and isn't, because the day job comes first.",
    does: [
      {
        title: "Four kinds of content, on demand",
        body: "A 600–900 word blog post, a set of three social posts, a marketing email with a subject line, or three ad variants. Say the topic; it writes the piece.",
      },
      {
        title: "In your voice, not a robot's",
        body: "It uses the same business knowledge and tone as AssistIQ — your services, your area, your way of putting things — and is barred from inventing prices you never set.",
      },
      {
        title: "A campaign, not a one-off",
        body: "Build a run of content around one theme and one goal, so a promotion has a blog, the posts and the email all pulling the same way.",
      },
      {
        title: "Ready to publish, not a first draft",
        body: "No preamble, no 'here's what I wrote' — output is the content itself. Schedule it, mark it published, and see what's gone out.",
      },
    ],
    loginHref: "/login",
    leadSource: "product-contentiq",
    live: true,
    accent: "#EC4899",
    group: "core",
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
    group: "industry",
  },
  {
    // Renamed from PermitIQ on 2026-08-05. "Permit" is the American word and
    // "planning permission" is the Irish one, and the product does both — so
    // the name now leads with the part that is the same on either side of the
    // Atlantic: you are getting a plan in front of an authority.
    //
    // `leadSource` deliberately stays "product-permitiq". It is the value
    // already stored against every lead this page has ever produced, and the
    // leads list filters and counts on that raw string — changing it would
    // split one product's pipeline across two labels. The slug, the name and
    // the URL are what customers see; this one is internal.
    slug: "planiq",
    name: "PlanIQ",
    kicker: "For architects, engineers, developers & contractors",
    headline: "Know what's missing before the council does.",
    sub: "Planning permission in Ireland and building permits in the US. Upload the drawings and reports, and get a checklist, a plain-English summary and the gaps — before you submit.",
    who: "Architects, engineers, planning consultants, developers and contractors — putting an application in front of an Irish planning authority, or pulling a building permit with a US building department.",
    does: [
      {
        title: "Both sides of the Atlantic, one system",
        body: "Ireland ships with the national planning-permission and retention lists. The US ships with the requirements a residential building permit asks for almost everywhere — and because permitting there is set city by city, naming your building department layers their own rules on top.",
      },
      {
        title: "Every document read",
        body: "Upload a drawing or report and it is read, described in plain English, and matched to the requirement it satisfies. Problems an assessor would flag — no scale bar, an undated notice — are called out.",
      },
      {
        title: "A checklist against the real requirements",
        body: "The baseline for your jurisdiction plus anything your specific authority asks for on top, resolved into one list with nothing duplicated.",
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
    group: "industry",
  },
  /**
   * The four that had a brand and no address.
   *
   * QuoteIQ, ClientIQ, LeadIQ and CustomIQ are named on the portal, in the
   * chat answers and out loud on calls, and until now every one of them lived
   * at a URL carrying its old internal name — /portal/instant-quote-agent,
   * /portal/crm-agent, /portal/speed-to-lead-agent, /portal/custom-solutions.
   * Behind a login, and unguessable. "It's automateiq.ie slash quoteiq" was a
   * 404.
   *
   * Each one below is a real, separately-entitled product: `instant-quote-agent`,
   * `crm-agent`, `speed-to-lead-agent` and `custom-solutions` are distinct keys
   * in `business_products`, so a customer can be given one without the others.
   * Every bullet is checked against what the portal route actually does — see
   * lib/products/unbacked-claims.test.ts for why that rule exists.
   */
  {
    slug: "quoteiq",
    name: "QuoteIQ",
    kicker: "For anyone who quotes for a living",
    headline: "Price the job before you leave it.",
    sub: "Describe the work and get a priced, itemised quote you can send from the van — then see when it's opened, accepted or declined.",
    who: "Trades, installers and contractors who lose work because the quote took three evenings to write and went out cold.",
    does: [
      {
        title: "Job description in, priced quote out",
        body: "Type what the job involves and it comes back itemised, using your own rates. Set your price guide once and every quote after it is priced the way you price.",
      },
      {
        title: "Sent as a link, not a PDF nobody opens",
        body: "The customer gets their own page. You see when it was viewed, and they accept or decline on it — so you stop ringing to ask whether they got it.",
      },
      {
        title: "The accepted quote becomes the invoice",
        body: "One step, and it's keyed to the quote it came from — so the same job can never be invoiced twice by accident.",
      },
      {
        title: "You find out whether your pricing works",
        body: "Acceptance rate, value won and value still out, off the quotes you actually sent. Not a feeling about how the year is going.",
      },
    ],
    loginHref: "/login",
    leadSource: "product-quoteiq",
    live: true,
    accent: "#EA580C",
    group: "module",
  },
  {
    slug: "clientiq",
    name: "ClientIQ",
    kicker: "For the customer list living in a phone",
    headline: "Every customer and lead in one place.",
    sub: "One pipeline for everyone who has ever contacted you, with a stage, a history and a follow-up task — instead of a search back through WhatsApp.",
    who: "Any business whose customer records are spread across a phone, a notebook, an inbox and somebody's memory.",
    does: [
      {
        title: "It imports what the rest already knows",
        body: "One button pulls in the customers ReputationIQ has asked for reviews, the enquiries SiteIQ has captured and everyone QuoteIQ has priced a job for. Nothing typed twice.",
      },
      {
        title: "A pipeline, not a list",
        body: "New, contacted, qualified, won, lost. Change someone's stage in one click and the board shows you what's actually live rather than everyone you've ever met.",
      },
      {
        title: "Follow-ups you can't forget",
        body: "Put a task with a due date against a contact. Open tasks sit at the top, soonest due first, and stay there until they're ticked.",
      },
      {
        title: "Findable",
        body: "Search across every record by name, email or company — whichever product it arrived from.",
      },
    ],
    loginHref: "/login",
    leadSource: "product-clientiq",
    live: true,
    accent: "#3B82F6",
    group: "module",
  },
  {
    slug: "leadiq",
    name: "LeadIQ",
    kicker: "For the enquiry that goes cold in an hour",
    headline: "Answer every enquiry before your competitor reads theirs.",
    sub: "An enquiry through your page gets a personal reply immediately, day or night — your wording, your name, and logged where you can see it went.",
    who: "Any business where enquiries land while you're up a ladder, driving or asleep, and the first reply wins the job.",
    does: [
      {
        title: "Replies as the enquiry lands",
        body: "Not a queue that runs later — the reply goes out in the same moment the form is submitted, which is the whole point of it.",
      },
      {
        title: "Your words, not a robot's",
        body: "You write the subject and the template once. The preview shows it with your real business name filled in, so what you approved is what sends.",
      },
      {
        title: "Never the same email twice",
        body: "It checks what has already gone to that person before sending. Someone who enquires twice in a week is not auto-replied to twice.",
      },
      {
        title: "On, off, and counted",
        body: "Pause it any time. Replies sent all-time and this week sit on the page, so “we get back to people fast” becomes a number.",
      },
    ],
    loginHref: "/login",
    leadSource: "product-leadiq",
    live: true,
    accent: "#F59E0B",
    group: "module",
  },
  {
    slug: "customiq",
    name: "CustomIQ",
    kicker: "For the job no product covers",
    headline: "The system that doesn't exist yet.",
    sub: "A module built around exactly how your business works, that appears in your portal beside everything else — same login, same records, nothing extra to remember.",
    who: "Businesses with a repetitive job no off-the-shelf product fits — the one everyone works around instead of solving.",
    does: [
      {
        title: "Built around your process",
        body: "Describe the job that eats the week. What gets built is shaped to how you already work rather than a template you have to bend yourself to.",
      },
      {
        title: "It lives where everything else lives",
        body: "Your module appears on your own page and in your sidebar. No install, no second login, no separate tool nobody opens after week two.",
      },
      {
        title: "On the same records",
        body: "It reads and writes the same customers and jobs as the rest of your account, so it's part of the system instead of sitting beside it.",
      },
      {
        title: "Most of the range started here",
        body: "TradeIQ, FinanceIQ and PlanIQ were each one company's problem first. If yours turns out to be common, it becomes a product.",
      },
    ],
    loginHref: "/login",
    leadSource: "product-customiq",
    live: true,
    accent: "#F472B6",
    group: "module",
  },
];

/** Section headings for the index, in render order. */
export const MARKETING_GROUPS = [
  {
    key: "industry" as const,
    label: "Built for your industry",
    blurb: "Each one is a full product for a specific kind of business. Switch on the one that matches what you do.",
  },
  {
    key: "core" as const,
    label: "The core three, whatever you run",
    blurb: "Not industry-specific — these sit under everything else and any account can switch them on.",
  },
  {
    key: "module" as const,
    label: "Or just the one piece you need",
    blurb: "You don't have to take a whole product. Each of these is a single job done properly on the same core — three of them are the parts TradeIQ is assembled from, and CustomIQ is where we build the one that doesn't exist yet.",
  },
];

/**
 * The range grouped for rendering. Empty groups are dropped, so a group with
 * nothing in it never renders an empty heading.
 */
export function marketingGroups(): {
  group: (typeof MARKETING_GROUPS)[number];
  products: MarketingProduct[];
}[] {
  return MARKETING_GROUPS.map((group) => ({
    group,
    products: MARKETING_PRODUCTS.filter((p) => p.group === group.key),
  })).filter((g) => g.products.length > 0);
}

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
