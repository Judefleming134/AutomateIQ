import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingTableError } from "@/lib/db/errors";

/**
 * Is each product actually sellable RIGHT NOW?
 *
 * Every product's tables live in a `supabase/manual_update_*.sql` file that has
 * to be pasted into the SQL Editor by hand. Nothing in the app knows whether
 * that was done. So the honest answer to "can I sell ClientIQ today?" was: try
 * it on a real customer and find out.
 *
 * That is a bad way to find out. A customer buys a product, logs in, and the
 * first thing the software does is fail — which is the single most expensive
 * moment in the whole funnel to be broken. (#508 fixed what they were TOLD
 * when it happened; this is about knowing before it happens.)
 *
 * So: probe each product's primary table with a head-only count and report
 * READY or NOT SET UP, with the exact file to run. Cheap — no rows come back —
 * and it answers the question in one screen instead of one incident.
 *
 * The probe uses the ADMIN client deliberately. RLS would hide rows from a
 * service-role-less caller and make an existing table look empty, but "empty"
 * and "missing" are the two states this has to tell apart.
 */

export type ProductProbe = {
  /** Entitlement key — matches products.key and PRODUCT_REGISTRY. */
  key: string;
  /** What Jude calls it when selling it. */
  name: string;
  /** The table whose absence breaks the product completely. */
  table: string;
  /** The file that creates it. Shown to Jude — this is an admin screen. */
  migration: string;
};

/**
 * One entry per sellable product, naming the table that has to exist for the
 * product to work at all. Deliberately the PRIMARY table, not every table: the
 * question is "would a customer hit a wall", and the first write always goes
 * through these.
 */
export const PRODUCT_PROBES: ProductProbe[] = [
  { key: "review-agent", name: "ReputationIQ", table: "ra_review_requests", migration: "supabase/migrations (base schema)" },
  { key: "website-agent", name: "SiteIQ", table: "wa_pages", migration: "supabase/manual_update_0005.sql" },
  { key: "ai-assistant", name: "AssistIQ", table: "aa_assistants", migration: "supabase/manual_update_0005.sql" },
  { key: "content-agent", name: "ContentIQ", table: "ca_campaigns", migration: "supabase/manual_update_0008.sql" },
  { key: "instant-quote-agent", name: "QuoteIQ", table: "qa_quotes", migration: "supabase/manual_update_0007.sql" },
  { key: "crm-agent", name: "ClientIQ", table: "crm_contacts", migration: "supabase/manual_update_0008.sql" },
  { key: "speed-to-lead-agent", name: "LeadIQ", table: "stl_settings", migration: "supabase/manual_update_0007.sql" },
  { key: "permitiq", name: "PlanIQ", table: "pq_applications", migration: "supabase/migrations/0033_permitiq.sql" },
  { key: "assetiq", name: "AssetIQ", table: "ast_assets", migration: "supabase/migrations/0045_assetiq.sql" },
  { key: "voice-agent", name: "ReceptionIQ", table: "va_config", migration: "supabase/manual_update_0006.sql" },
  { key: "logistics-control-centre", name: "Logistics control centre", table: "log_routes", migration: "supabase/manual_update_0015.sql" },
  { key: "instagram-dm-setter", name: "Instagram DM setter", table: "ig_settings", migration: "supabase/manual_update_0011.sql" },
];

export type ReadinessState = "ready" | "missing" | "error";

export type ProductReadiness = ProductProbe & {
  state: ReadinessState;
  /** Populated when state is "error" — something other than a missing table. */
  detail: string | null;
};

export type ReadinessReport = {
  results: ProductReadiness[];
  ready: number;
  missing: number;
  errored: number;
  /** True when every product is sellable today. */
  allReady: boolean;
};

/**
 * Summarises probe results. Pure, so the counting and the "can I sell this"
 * verdict are testable without a database.
 */
export function summariseReadiness(results: ProductReadiness[]): ReadinessReport {
  const ready = results.filter((r) => r.state === "ready").length;
  const missing = results.filter((r) => r.state === "missing").length;
  const errored = results.filter((r) => r.state === "error").length;
  return {
    results,
    ready,
    missing,
    errored,
    // An errored probe is NOT ready. Counting only `missing` would report
    // "all ready" while a product was failing for a reason we couldn't name —
    // the reporting-success-for-work-that-didn't-happen shape, aimed at Jude.
    allReady: results.length > 0 && ready === results.length,
  };
}

/**
 * The order Jude should read them in: broken first, then unknown, then fine.
 * Within a group, registry order is kept so the list doesn't reshuffle between
 * loads.
 */
export function readinessRank(state: ReadinessState): number {
  return state === "missing" ? 0 : state === "error" ? 1 : 2;
}

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
type Client = SupabaseClient<any, any, any>;

/** Probes one product's table. Never throws — a probe that blows up would
 *  take the whole readiness page down, which is the opposite of the point. */
export async function probeProduct(
  admin: Client,
  probe: ProductProbe
): Promise<ProductReadiness> {
  try {
    const { error } = await admin
      .from(probe.table)
      .select("*", { count: "exact", head: true });
    if (!error) return { ...probe, state: "ready", detail: null };
    if (isMissingTableError(error)) return { ...probe, state: "missing", detail: null };
    return { ...probe, state: "error", detail: error.message };
  } catch (err) {
    return {
      ...probe,
      state: "error",
      detail: err instanceof Error ? err.message : "unknown error",
    };
  }
}

/** Probes every product, in parallel — eleven head-only counts. */
export async function checkProductReadiness(admin: Client): Promise<ReadinessReport> {
  const results = await Promise.all(PRODUCT_PROBES.map((p) => probeProduct(admin, p)));
  const ordered = [...results].sort(
    (a, b) => readinessRank(a.state) - readinessRank(b.state)
  );
  return summariseReadiness(ordered);
}
