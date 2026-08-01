import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { selectAllRows } from "./db";
import { isMissingTableError } from "@/lib/db/errors";

/**
 * What the Prospects page needs, without reading the whole database to get it.
 *
 * That page did three FULL TABLE READS on every load — every page-turn, every
 * search, every filter change:
 *
 *   1. every prospect's `industry`, to build a <select> of ~32 distinct values
 *   2. every active prospect, to work out which still need researching
 *   3. every row of ge_research, for the same reason
 *
 * At Jude's scale that is ~42,000 rows serialised to JSON over ~20 paged
 * PostgREST requests, reduced in Node to a 32-item dropdown and a 300-row
 * queue. Postgres answers all three in under 10ms — the cost is the transfer
 * and the parse, not the query.
 *
 * Migration 0042 adds two views that answer the questions we actually have.
 * Same answers, 332 rows instead of 42,001, in 3 requests instead of ~20.
 *
 * Both paths live here: if the views are absent (migration not run), the old
 * full-scan path runs exactly as before. The page cannot tell the difference
 * apart from the speed, which is the point.
 */

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
type Client = SupabaseClient<any, any, any>;

export type QueueProspect = {
  id: string;
  company: string;
  website: string | null;
  status: string;
};

export type ProspectQueues = {
  /** Distinct industries in use, sorted, for the filter dropdown. */
  industries: string[];
  /** Fresh leads to research, website-first. Bounded. */
  fresh: QueueProspect[];
  /** How many fresh leads there are in total — not just the batch. */
  freshTotal: number;
  /** Leads whose research failed, for the retry group. Bounded. */
  failed: QueueProspect[];
  /** How many failed in total. */
  failedTotal: number;
  /** True when the fast path was used. Reported so a slow page is explicable. */
  usedViews: boolean;
};

/** Rows handed to the research queue component; more is wasted payload. */
const FRESH_BATCH = 300;
const FAILED_BATCH = 60;

const CLOSED = '("won","lost","do_not_contact","archived")';

/** A missing view reports like a missing table (PGRST205), plus 42P01. */
function viewMissing(error: unknown): boolean {
  if (isMissingTableError(error)) return true;
  const message = (error as { message?: string })?.message ?? "";
  return /ge_unresearched_prospects|ge_prospect_industries/i.test(message);
}

export async function loadProspectQueues(admin: Client): Promise<ProspectQueues> {
  const fast = await tryViews(admin);
  if (fast) return fast;
  return legacyScan(admin);
}

/** The fast path: three small reads, all the work done in Postgres. */
async function tryViews(admin: Client): Promise<ProspectQueues | null> {
  const [industryRes, freshRes, failedRes] = await Promise.all([
    admin.from("ge_prospect_industries").select("industry"),
    admin
      .from("ge_unresearched_prospects")
      .select("id, company, website, status", { count: "exact" })
      .neq("status", "research_failed")
      // Website first: the engine reads the site, so a lead with one
      // researches far better. Materialised in the view because PostgREST can
      // only order by a column.
      .order("has_website", { ascending: false })
      .order("created_at", { ascending: false })
      // Bulk imports share timestamps; without a unique tiebreak a paged read
      // shuffles between refreshes and can skip or repeat a row.
      .order("id", { ascending: true })
      .limit(FRESH_BATCH),
    admin
      .from("ge_unresearched_prospects")
      .select("id, company, website, status", { count: "exact" })
      .eq("status", "research_failed")
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .limit(FAILED_BATCH),
  ]);

  // Any one of them missing means the migration has not been run. Fall back
  // rather than render a half-empty page.
  if (
    viewMissing(industryRes.error) ||
    viewMissing(freshRes.error) ||
    viewMissing(failedRes.error)
  ) {
    return null;
  }
  // A real error (timeout, permissions) is also a reason to take the old
  // path — it worked yesterday and the page is more important than the speed.
  if (industryRes.error || freshRes.error || failedRes.error) return null;

  return {
    industries: (industryRes.data ?? [])
      .map((r) => String(r.industry ?? "").trim())
      .filter(Boolean),
    fresh: (freshRes.data ?? []) as QueueProspect[],
    freshTotal: freshRes.count ?? (freshRes.data ?? []).length,
    failed: (failedRes.data ?? []) as QueueProspect[],
    failedTotal: failedRes.count ?? (failedRes.data ?? []).length,
    usedViews: true,
  };
}

/**
 * The original path, unchanged in behaviour: read everything, work it out in
 * Node. Kept so the page is identical before migration 0042 is run.
 */
async function legacyScan(admin: Client): Promise<ProspectQueues> {
  const [industriesRaw, allProspects, researched] = await Promise.all([
    selectAllRows<{ industry: string | null }>(() =>
      admin.from("ge_prospects").select("industry").not("industry", "is", null)
    ),
    selectAllRows<QueueProspect>(() =>
      admin
        .from("ge_prospects")
        .select("id, company, website, status")
        .not("status", "in", CLOSED)
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
    ),
    selectAllRows<{ prospect_id: string }>(() =>
      admin.from("ge_research").select("prospect_id").order("prospect_id")
    ),
  ]);

  const researchedIds = new Set(researched.map((r) => r.prospect_id));
  const failed = allProspects.filter(
    (p) => p.status === "research_failed" && !researchedIds.has(p.id)
  );
  // Array.sort is stable, so the created_at-desc order survives within each
  // has-website group.
  const fresh = allProspects
    .filter((p) => !researchedIds.has(p.id) && p.status !== "research_failed")
    .sort((a, b) => Number(Boolean(b.website)) - Number(Boolean(a.website)));

  return {
    industries: [
      ...new Set(industriesRaw.map((r) => r.industry?.trim()).filter(Boolean)),
    ].sort() as string[],
    fresh: fresh.slice(0, FRESH_BATCH),
    freshTotal: fresh.length,
    failed: failed.slice(0, FAILED_BATCH),
    failedTotal: failed.length,
    usedViews: false,
  };
}
