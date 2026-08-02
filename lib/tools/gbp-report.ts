/**
 * The Google Business Profile REPORT — the scoring, the findings and the
 * verdict, with no idea where the facts came from.
 *
 * This used to live inside `checkGbp`, welded to the Places API response. That
 * made the whole tool cost money: the analysis is ours and always was, but the
 * only way to reach it was a billed Google lookup, so the tool sat switched off
 * (J1) waiting on a card being put on file.
 *
 * Splitting it means the same engine can be fed from two places:
 *
 *   lib/tools/gbp.ts       Places API  — richer, needs a billing account
 *   lib/tools/gbp-self.ts  the visitor — free, works today, works for a
 *                          business that has NO profile at all (which the
 *                          Places path cannot even score)
 *
 * Deliberately NOT `server-only`: the self-check runs in the browser with no
 * round trip, so it costs nothing to serve and can't be rate-limited into a
 * dead end. Nothing in here reads process.env or touches the network — keep it
 * that way, or the import in the client component starts failing at build.
 */

export type GbpFinding = {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail";
  impact: "high" | "medium" | "low";
  found: string;
  why: string;
  fix: string;
};

export type GbpResult = {
  name: string;
  address: string;
  rating: number | null;
  reviewCount: number;
  primaryType: string | null;
  mapsUri: string | null;
  score: number;
  verdict: string;
  findings: GbpFinding[];
  /** How to describe the review count / rating in the header. Set when the
   *  underlying answer was a band rather than an exact figure — printing the
   *  representative number instead would be inventing data. */
  reviewCountLabel: string | null;
  ratingLabel: string | null;
  /** Where the facts came from. The report says so on screen — a self-declared
   *  score must never be presented as something we looked up. */
  source: "google" | "self";
};

/**
 * The normalised facts a report is built from.
 *
 * The `*Label` fields exist so a bucketed answer is never rendered as a fake
 * precise number. "8–24 reviews" is what the visitor told us; printing
 * "15 reviews" back at them would be inventing data, and it's the sort of
 * detail that makes someone stop trusting the whole page.
 */
export type GbpProfile = {
  name: string;
  address: string;
  rating: number | null;
  /** How to describe the rating. Falls back to the number. */
  ratingLabel?: string | null;
  /** Representative count, used for the thresholds. */
  reviewCount: number;
  /** How to describe the count. Falls back to the number. */
  reviewCountLabel?: string | null;
  primaryType: string | null;
  mapsUri: string | null;
  phone: string | null;
  website: string | null;
  hoursListed: boolean;
  /** Number of days with hours, when we actually know it. */
  hoursDays: number | null;
  descriptionWritten: boolean;
  /** Google's own status string, e.g. CLOSED_PERMANENTLY. Null when unknown. */
  businessStatus: string | null;
  source: "google" | "self";
};

const WEIGHT = { high: 10, medium: 5, low: 2 } as const;
const CREDIT = { pass: 1, warn: 0.5, fail: 0 } as const;

/** "You said" for a self-check, plain statement for a looked-up profile. */
const said = (p: GbpProfile, self: string, google: string) =>
  p.source === "self" ? self : google;

export function buildGbpReport(p: GbpProfile): GbpResult {
  const findings: GbpFinding[] = [];

  const reviewText =
    p.reviewCountLabel ?? `${p.reviewCount} review${p.reviewCount === 1 ? "" : "s"}`;
  const ratingText =
    p.ratingLabel ?? (p.rating === null ? "No rating yet" : `${p.rating.toFixed(1)} out of 5`);

  findings.push({
    id: "reviews",
    label: "Number of reviews",
    impact: "high",
    status: p.reviewCount >= 25 ? "pass" : p.reviewCount >= 8 ? "warn" : "fail",
    found: `${reviewText}${p.rating !== null && !p.ratingLabel ? `, averaging ${p.rating.toFixed(1)}` : ""}`,
    why: "Review count is one of the strongest signals deciding who appears in the map pack, and it's the first thing a customer compares. Below about ten, you look new — whether you've been going twenty years or not.",
    fix:
      p.reviewCount >= 25
        ? "Good base. Keep them coming — recency counts as well as volume."
        : "Ask every happy customer, the day the job finishes, with a direct link. That single habit moves this faster than anything else on this page.",
  });

  findings.push({
    id: "rating",
    label: "Star rating",
    impact: "high",
    status: p.rating === null ? "fail" : p.rating >= 4.5 ? "pass" : p.rating >= 4.0 ? "warn" : "fail",
    found: ratingText,
    why: "Under 4.0 and people scroll past you without reading a word. Between 4.0 and 4.5 you're in the pack but not winning it. The gap between 4.3 and 4.7 is worth more calls than most advertising.",
    fix:
      p.rating !== null && p.rating >= 4.5
        ? "Strong. Protect it by replying to every review, good and bad."
        : "You can't delete bad reviews, but you can outweigh them. A steady flow of new ones moves the average faster than arguing with old ones ever will.",
  });

  findings.push({
    id: "hours",
    label: "Opening hours",
    impact: "medium",
    status: p.hoursListed ? "pass" : "fail",
    found: p.hoursListed
      ? p.hoursDays !== null
        ? `Listed for ${p.hoursDays} days`
        : said(p, "You said they're listed", "Listed")
      : said(p, "You said they're not listed", "Not listed"),
    why: "Google actively pushes profiles with no hours down in local results, and 'Open now' is one of the filters people actually use. Missing hours also means nobody knows whether to ring you at 7pm.",
    fix: p.hoursListed
      ? "Listed. Keep bank holidays updated."
      : "Add your hours — it takes two minutes and it's one of the cheapest wins available.",
  });

  findings.push({
    id: "phone",
    label: "Phone number",
    impact: "high",
    status: p.phone ? "pass" : "fail",
    found: p.phone ?? said(p, "You said there isn't one on it", "No phone number on the profile"),
    why: "The call button on your profile is the single most-used thing on it. Without a number, someone ready to book has nothing to press.",
    fix: p.phone
      ? "Present."
      : "Add it, and make sure it matches the number on your website exactly.",
  });

  findings.push({
    id: "website",
    label: "Website link",
    impact: "medium",
    status: p.website ? "pass" : "warn",
    found: p.website ?? said(p, "You said nothing's linked", "No website linked"),
    why: "The link sends profile traffic to your site, and it's part of how Google connects the two so they reinforce each other rather than competing.",
    fix: p.website
      ? "Linked."
      : "Link your site — and if you haven't got one, the profile is doing all the work alone.",
  });

  findings.push({
    id: "category",
    label: "Business category",
    impact: "high",
    status: p.primaryType ? "pass" : "fail",
    found: p.primaryType ?? said(p, "You said none is set", "No primary category set"),
    why: "Your category is what Google matches against the search itself. Wrong or missing category means you simply don't enter the running, no matter how good the rest is.",
    fix: p.primaryType
      ? "Set. Check it's the most specific one that fits — 'Plumber' beats 'Contractor'."
      : "Set your primary category to the most specific match for what you actually do.",
  });

  findings.push({
    id: "description",
    label: "Business description",
    impact: "low",
    status: p.descriptionWritten ? "pass" : "warn",
    found: p.descriptionWritten
      ? said(p, "You said it's written", "Written")
      : said(p, "You said it isn't written", "Not written"),
    why: "750 characters to say what you do, where you cover, and why someone should pick you. It won't rank you on its own, but it's read by people already deciding.",
    fix: p.descriptionWritten
      ? "Present."
      : "Write it — services, areas covered, what makes you different. Plain words.",
  });

  if (p.businessStatus && p.businessStatus !== "OPERATIONAL") {
    findings.unshift({
      id: "status",
      label: "Profile status",
      impact: "high",
      status: "fail",
      found: `Google lists this business as ${p.businessStatus.toLowerCase().replace(/_/g, " ")}`,
      why: "Google is telling everyone who finds you that you're closed. Nothing else on this list matters while that's true.",
      fix: "Sign into your Business Profile and set the status back to open. If you've lost access to the profile, claim it — that's the whole job today.",
    });
  }

  const earned = findings.reduce((n, f) => n + WEIGHT[f.impact] * CREDIT[f.status], 0);
  const total = findings.reduce((n, f) => n + WEIGHT[f.impact], 0);
  const score = total ? Math.round((earned / total) * 100) : 0;

  const worst =
    findings.find((f) => f.status === "fail") ?? findings.find((f) => f.status === "warn");
  const verdict = !worst
    ? "This profile is in good shape — the basics are all covered."
    : worst.id === "status"
      ? "Google is currently telling people you're closed."
      : worst.id === "reviews" || worst.id === "rating"
        ? "Your profile is set up, but your reviews are what's holding you out of the map pack."
        : `The biggest gap is your ${worst.label.toLowerCase()}.`;

  return {
    name: p.name,
    address: p.address,
    rating: p.rating,
    reviewCount: p.reviewCount,
    primaryType: p.primaryType,
    mapsUri: p.mapsUri,
    score,
    verdict,
    source: p.source,
    reviewCountLabel: p.reviewCountLabel ?? null,
    ratingLabel: p.ratingLabel ?? null,
    findings: findings.sort((a, b) => {
      const s = { fail: 0, warn: 1, pass: 2 };
      const i = { high: 0, medium: 1, low: 2 };
      return s[a.status] - s[b.status] || i[a.impact] - i[b.impact];
    }),
  };
}

/**
 * The report for a business with NO profile at all.
 *
 * Worth its own function rather than a zero-score run of the above: every
 * finding would read "not set", which buries the only thing that matters under
 * six things that can't be done yet. It is also the one case the Places API
 * could never report — no profile means no result means "not found", so the
 * paid path had nothing to say to the business with the most to gain.
 */
export function noProfileReport(name: string, address = ""): GbpResult {
  return {
    name: name || "Your business",
    address,
    rating: null,
    reviewCount: 0,
    primaryType: null,
    mapsUri: null,
    score: 0,
    source: "self",
    reviewCountLabel: "No profile, so no reviews",
    ratingLabel: "No rating",
    verdict: "You haven't got a Business Profile — that's the whole reason you're not in the map pack.",
    findings: [
      {
        id: "no-profile",
        label: "Google Business Profile",
        status: "fail",
        impact: "high",
        found: "You said you haven't got one (or aren't sure)",
        why: "The map pack — the three businesses with the little map above the normal results — is drawn ENTIRELY from Business Profiles. No profile means you cannot appear there at any price, and for 'plumber near me' type searches that block is most of the page on a phone. It is also where your reviews would live.",
        fix: "Create one at google.com/business. It's free, it takes about twenty minutes, and Google posts a postcard with a code to verify your address — so start it today and it's live within the week. Name, category, phone, hours, area covered. Then come back and run this again.",
      },
      {
        id: "no-profile-reviews",
        label: "Reviews",
        status: "fail",
        impact: "high",
        found: "Nowhere for a customer to leave one",
        why: "Google reviews only exist on a Business Profile. Without one, twenty years of happy customers count for nothing on the search page — and every competitor with a profile looks established next to you.",
        fix: "Once the profile is verified, ask your last ten customers. Ten good reviews in a fortnight puts you ahead of most local trades from a standing start.",
      },
      {
        id: "no-profile-next",
        label: "In the meantime",
        status: "warn",
        impact: "medium",
        found: "Your website is doing all the work alone",
        why: "Until the profile is verified, your site is the only thing Google has to go on for you. That makes the basics on it — your name, address and phone in readable text, and your business schema — matter more than usual, not less.",
        fix: "Run the free website checker while you wait for the postcard. It tells you exactly what to add and gives you the code to paste.",
      },
    ],
  };
}
