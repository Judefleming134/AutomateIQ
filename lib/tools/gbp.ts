import "server-only";

import { buildGbpReport, type GbpResult } from "@/lib/tools/gbp-report";

// Re-exported so existing importers of this module keep working unchanged.
export type { GbpFinding, GbpResult, GbpProfile } from "@/lib/tools/gbp-report";

/**
 * Google Business Profile checker.
 *
 * For a local trade the Business Profile matters MORE than the website — it's
 * what fills the map pack, and it's where the reviews live. This reads the
 * public profile through the Places API and reports the handful of things that
 * decide whether a business appears in "plumber near me".
 *
 * This is the RICH path and it costs money: Places needs a billing account
 * attached, which is why the tool sat switched off (J1). The scoring, the
 * findings and the verdict are no longer in here — they moved to
 * `lib/tools/gbp-report.ts` so the free self-check in `gbp-self.ts` produces a
 * byte-identical report from facts the visitor supplies instead. This path
 * stays exactly as it was and lights up on its own the day a key is set.
 */

const PLACES_SEARCH = "https://places.googleapis.com/v1/places:searchText";

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

  return buildGbpReport({
    name: raw.displayName?.text ?? "Unknown",
    address: raw.formattedAddress ?? "",
    rating: raw.rating ?? null,
    reviewCount: raw.userRatingCount ?? 0,
    primaryType: raw.primaryTypeDisplayName?.text ?? null,
    mapsUri: raw.googleMapsUri ?? null,
    phone: raw.nationalPhoneNumber ?? null,
    website: raw.websiteUri ?? null,
    hoursListed: (raw.regularOpeningHours?.weekdayDescriptions ?? []).length > 0,
    hoursDays: raw.regularOpeningHours?.weekdayDescriptions?.length ?? null,
    descriptionWritten: !!raw.editorialSummary?.text,
    businessStatus: raw.businessStatus ?? null,
    source: "google",
  });
}
