/**
 * Tool slugs and their human names — the client-safe half of the catalog.
 *
 * `lib/tools/catalog.ts` is `server-only` because it reads env to decide what
 * is switched on. The lead-capture form runs in the browser and the API route
 * validates against the same list, so the names live here where both can
 * reach them, and the catalog imports from here rather than repeating itself.
 */

export const TOOL_LABELS = {
  autoseo: "website SEO check",
  "google-profile": "Google Business Profile check",
  "response-time": "reply-speed test",
  "missed-calls": "missed-calls calculator",
  reviews: "review reply writer",
  "quote-builder": "quote widget builder",
} as const;

export type ToolSlug = keyof typeof TOOL_LABELS;

export const ALL_TOOL_SLUGS = Object.keys(TOOL_LABELS) as ToolSlug[];

export function toolLabel(slug: string): string {
  return TOOL_LABELS[slug as ToolSlug] ?? "free tool";
}
