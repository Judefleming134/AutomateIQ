import "server-only";

/**
 * Google Business Profile checker.
 *
 * For a local trade the Business Profile matters MORE than the website — it's
 * what fills the map pack, and it's where the reviews live. This reads the
 * public profile through the Places API and reports the handful of things that
 * decide whether a business appears in "plumber near me".
 *
 * Requires GOOGLE_PLACES_API_KEY. Places has a standing monthly free credit
 * that comfortably covers this tool's volume, but it does need a billing
 * account attached, so the tool reports itself as unconfigured rather than
 * silently returning nothing.
 */

const PLACES_SEARCH = "https://places.googleapis.com/v1/places:searchText";

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
};

export type GbpFailure = { error: "not_configured" | "not_found" | "upstream"; message: string };

export function gbpConfigured(): boolean {
  return !!process.env.GOOGLE_PLACES_API_KEY;
}

type PlaceRaw = {
  displayName?: { text?: string };
  formattedAddress?: string;
  rating?: number;
  userRatingCount?: number;
  primaryTypeDisplayName?: { text?: string };
  googleMapsUri?: string;
  nationalPhoneNumber?: string;
  websiteUri?: string;
  regularOpeningHours?: { weekdayDescriptions?: string[] };
  businessStatus?: string;
  editorialSummary?: { text?: string };
};

/** The fields we ask for — Places bills by field mask, so keep it tight. */
const FIELD_MASK = [
  "places.displayName",
  "places.formattedAddress",
  "places.rating",
  "places.userRatingCount",
  "places.primaryTypeDisplayName",
  "places.googleMapsUri",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.regularOpeningHours",
  "places.businessStatus",
  "places.editorialSummary",
].join(",");

export async function checkGbp(query: string): Promise<GbpResult | GbpFailure> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) {
    return {
      error: "not_configured",
      message: "The Google Business Profile checker isn't switched on yet.",
    };
  }

  let raw: PlaceRaw | undefined;
  try {
    const res = await fetch(PLACES_SEARCH, {
      method: "POST",
      signal: AbortSignal.timeout(12_000),
      headers: {
        "content-type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify({ textQuery: query.slice(0, 200), languageCode: "en", regionCode: "IE" }),
    });
    if (!res.ok) {
      return { error: "upstream", message: "Couldn't reach Google just now. Try again shortly." };
    }
    const data = (await res.json()) as { places?: PlaceRaw[] };
    raw = data.places?.[0];
  } catch {
    return { error: "upstream", message: "Couldn't reach Google just now. Try again shortly." };
  }

  if (!raw) {
    return {
      error: "not_found",
      message:
        "No Google Business Profile found for that. Try the exact business name plus the town — and if there genuinely isn't one, that IS the finding: you're invisible in the map pack until you create it (it's free).",
    };
  }

  const reviewCount = raw.userRatingCount ?? 0;
  const rating = raw.rating ?? null;
  const hours = raw.regularOpeningHours?.weekdayDescriptions ?? [];
  const findings: GbpFinding[] = [];

  findings.push({
    id: "reviews",
    label: "Number of reviews",
    impact: "high",
    status: reviewCount >= 25 ? "pass" : reviewCount >= 8 ? "warn" : "fail",
    found: `${reviewCount} review${reviewCount === 1 ? "" : "s"}${rating ? `, averaging ${rating.toFixed(1)}` : ""}`,
    why: "Review count is one of the strongest signals deciding who appears in the map pack, and it's the first thing a customer compares. Below about ten, you look new — whether you've been going twenty years or not.",
    fix:
      reviewCount >= 25
        ? "Good base. Keep them coming — recency counts as well as volume."
        : "Ask every happy customer, the day the job finishes, with a direct link. That single habit moves this faster than anything else on this page.",
  });

  findings.push({
    id: "rating",
    label: "Star rating",
    impact: "high",
    status: rating === null ? "fail" : rating >= 4.5 ? "pass" : rating >= 4.0 ? "warn" : "fail",
    found: rating === null ? "No rating yet" : `${rating.toFixed(1)} out of 5`,
    why: "Under 4.0 and people scroll past you without reading a word. Between 4.0 and 4.5 you're in the pack but not winning it. The gap between 4.3 and 4.7 is worth more calls than most advertising.",
    fix:
      rating !== null && rating >= 4.5
        ? "Strong. Protect it by replying to every review, good and bad."
        : "You can't delete bad reviews, but you can outweigh them. A steady flow of new ones moves the average faster than arguing with old ones ever will.",
  });

  findings.push({
    id: "hours",
    label: "Opening hours",
    impact: "medium",
    status: hours.length > 0 ? "pass" : "fail",
    found: hours.length > 0 ? `Listed for ${hours.length} days` : "Not listed",
    why: "Google actively pushes profiles with no hours down in local results, and 'Open now' is one of the filters people actually use. Missing hours also means nobody knows whether to ring you at 7pm.",
    fix: hours.length > 0 ? "Listed. Keep bank holidays updated." : "Add your hours — it takes two minutes and it's one of the cheapest wins available.",
  });

  findings.push({
    id: "phone",
    label: "Phone number",
    impact: "high",
    status: raw.nationalPhoneNumber ? "pass" : "fail",
    found: raw.nationalPhoneNumber ?? "No phone number on the profile",
    why: "The call button on your profile is the single most-used thing on it. Without a number, someone ready to book has nothing to press.",
    fix: raw.nationalPhoneNumber ? "Present." : "Add it, and make sure it matches the number on your website exactly.",
  });

  findings.push({
    id: "website",
    label: "Website link",
    impact: "medium",
    status: raw.websiteUri ? "pass" : "warn",
    found: raw.websiteUri ?? "No website linked",
    why: "The link sends profile traffic to your site, and it's part of how Google connects the two so they reinforce each other rather than competing.",
    fix: raw.websiteUri ? "Linked." : "Link your site — and if you haven't got one, the profile is doing all the work alone.",
  });

  findings.push({
    id: "category",
    label: "Business category",
    impact: "high",
    status: raw.primaryTypeDisplayName?.text ? "pass" : "fail",
    found: raw.primaryTypeDisplayName?.text ?? "No primary category set",
    why: "Your category is what Google matches against the search itself. Wrong or missing category means you simply don't enter the running, no matter how good the rest is.",
    fix: raw.primaryTypeDisplayName?.text
      ? "Set. Check it's the most specific one that fits — 'Plumber' beats 'Contractor'."
      : "Set your primary category to the most specific match for what you actually do.",
  });

  findings.push({
    id: "description",
    label: "Business description",
    impact: "low",
    status: raw.editorialSummary?.text ? "pass" : "warn",
    found: raw.editorialSummary?.text ? "Written" : "Not written",
    why: "750 characters to say what you do, where you cover, and why someone should pick you. It won't rank you on its own, but it's read by people already deciding.",
    fix: raw.editorialSummary?.text ? "Present." : "Write it — services, areas covered, what makes you different. Plain words.",
  });

  if (raw.businessStatus && raw.businessStatus !== "OPERATIONAL") {
    findings.unshift({
      id: "status",
      label: "Profile status",
      impact: "high",
      status: "fail",
      found: `Google lists this business as ${raw.businessStatus.toLowerCase().replace(/_/g, " ")}`,
      why: "Google is telling everyone who finds you that you're closed. Nothing else on this list matters while that's true.",
      fix: "Sign into your Business Profile and set the status back to open. If you've lost access to the profile, claim it — that's the whole job today.",
    });
  }

  const WEIGHT = { high: 10, medium: 5, low: 2 };
  const CREDIT = { pass: 1, warn: 0.5, fail: 0 };
  const earned = findings.reduce((n, f) => n + WEIGHT[f.impact] * CREDIT[f.status], 0);
  const total = findings.reduce((n, f) => n + WEIGHT[f.impact], 0);
  const score = total ? Math.round((earned / total) * 100) : 0;

  const worst = findings.find((f) => f.status === "fail") ?? findings.find((f) => f.status === "warn");
  const verdict = !worst
    ? "This profile is in good shape — the basics are all covered."
    : worst.id === "status"
      ? "Google is currently telling people you're closed."
      : worst.id === "reviews" || worst.id === "rating"
        ? "Your profile is set up, but your reviews are what's holding you out of the map pack."
        : `The biggest gap is your ${worst.label.toLowerCase()}.`;

  return {
    name: raw.displayName?.text ?? "Unknown",
    address: raw.formattedAddress ?? "",
    rating,
    reviewCount,
    primaryType: raw.primaryTypeDisplayName?.text ?? null,
    mapsUri: raw.googleMapsUri ?? null,
    score,
    verdict,
    findings: findings.sort((a, b) => {
      const s = { fail: 0, warn: 1, pass: 2 };
      const i = { high: 0, medium: 1, low: 2 };
      return s[a.status] - s[b.status] || i[a.impact] - i[b.impact];
    }),
  };
}
