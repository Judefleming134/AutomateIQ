/**
 * The rest of what a SiteIQ page needs to be a business page rather than a
 * business card: the areas you cover, and the structured data that lets a
 * search engine understand any of it.
 *
 * "Do you cover Naas?" is the most common question a local business is asked
 * before anyone books anything, and the page had no way to answer it.
 */

import { hoursToSchema, type Hours } from "./hours";

/**
 * Enough areas to cover a county, few enough that the list still reads as a
 * real service area rather than keyword stuffing — which search engines
 * penalise and customers see straight through.
 */
export const MAX_AREAS = 24;
const MAX_AREA_LENGTH = 60;

/**
 * Areas served, from a comma- or newline-separated box.
 *
 * Deduped case-insensitively but stored as typed: "Naas" and "naas" are one
 * area, and the one the business wrote first is the one shown.
 */
export function parseAreas(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of (raw ?? "").split(/[,\n]/)) {
    const area = part.trim().replace(/\s+/g, " ");
    if (!area) continue;
    const key = area.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(area.slice(0, MAX_AREA_LENGTH));
    if (out.length >= MAX_AREAS) break;
  }
  return out;
}

export type PageForSchema = {
  name: string;
  slug: string;
  headline?: string | null;
  about?: string | null;
  services?: string[] | null;
  areas?: string[] | null;
  phone?: string | null;
  email?: string | null;
  logoUrl?: string | null;
  hours?: Hours | null;
};

/** The public address of a page. One definition, used by page, schema and sitemap. */
export function pageUrl(slug: string, origin = "https://automateiq.ie"): string {
  return `${origin.replace(/\/$/, "")}/b/${slug}`;
}

/**
 * schema.org LocalBusiness JSON-LD.
 *
 * Without this a page is a blue link. With it, a search result can carry the
 * business name, phone number, opening hours and service area — which is the
 * entire reason a business whose website is a business card wants a page at
 * all.
 *
 * Every field is omitted when empty rather than emitted blank: an empty
 * `telephone` is worse than no `telephone`, because it asserts there isn't
 * one.
 */
export function buildLocalBusinessSchema(
  page: PageForSchema,
  origin = "https://automateiq.ie"
): Record<string, unknown> {
  const url = pageUrl(page.slug, origin);
  const schema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: page.name,
    url,
    "@id": url,
  };

  const description = (page.about ?? "").trim() || (page.headline ?? "").trim();
  if (description) schema.description = description.slice(0, 300);
  if (page.phone?.trim()) schema.telephone = page.phone.trim();
  if (page.email?.trim()) schema.email = page.email.trim();
  if (page.logoUrl?.trim()) schema.image = page.logoUrl.trim();

  const areas = (page.areas ?? []).filter((a) => a.trim());
  if (areas.length) {
    schema.areaServed = areas.map((a) => ({ "@type": "Place", name: a }));
  }

  const services = (page.services ?? []).filter((s) => s.trim());
  if (services.length) {
    schema.hasOfferCatalog = {
      "@type": "OfferCatalog",
      name: `${page.name} services`,
      itemListElement: services.map((s) => ({
        "@type": "Offer",
        itemOffered: { "@type": "Service", name: s },
      })),
    };
  }

  const hours = page.hours ?? [];
  if (hours.length) schema.openingHoursSpecification = hoursToSchema(hours);

  return schema;
}

/**
 * The page's own meta description.
 *
 * Search engines truncate around 160 characters, so this cuts on a word
 * boundary rather than mid-word — a description ending "we cover Naas, Newb"
 * looks broken in the one place a stranger judges the business.
 */
export function metaDescription(page: {
  headline?: string | null;
  about?: string | null;
  areas?: string[] | null;
}): string | undefined {
  const parts = [(page.headline ?? "").trim(), (page.about ?? "").trim()].filter(Boolean);
  const areas = (page.areas ?? []).filter((a) => a.trim());
  if (areas.length) {
    parts.push(`Serving ${areas.slice(0, 4).join(", ")}${areas.length > 4 ? " and more" : ""}.`);
  }
  const text = parts.join(" ").replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  if (text.length <= 158) return text;
  const cut = text.slice(0, 158);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 100 ? cut.slice(0, lastSpace) : cut).replace(/[,;:.\s]+$/, "")}…`;
}
