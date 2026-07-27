import "server-only";

/** Minimal shape of a Supabase/PostgREST builder we can page with. */
type Rangeable<T> = {
  range: (
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
};

/**
 * Reads EVERY row a query would return, paging past PostgREST's per-request
 * row cap (~1,000 by default). A plain `.select()` is silently truncated at
 * that cap, which quietly corrupts any count or aggregate once a table grows
 * past it (the dashboard freezing at "1,000 prospects", dedupe missing
 * existing leads, the research queue never seeing later import batches). This
 * guarantees completeness at any table size.
 *
 * Pages are fetched in parallel WINDOWS (default 5 at a time) rather than one
 * after another, so a 5,000-row table is read in ~1 round trip instead of 5.
 * That keeps hot pages (dashboard, Jarvis) snappy well past 5k leads.
 *
 * `makeQuery` MUST return a fresh builder each call — a builder is single-use
 * once it has been ranged/awaited.
 */
export async function selectAllRows<T>(
  makeQuery: () => Rangeable<T>,
  pageSize = 1000,
  parallelPages = 5
): Promise<T[]> {
  // One page, with a single retry — a transient blip (statement timeout,
  // dropped connection) must not decide the shape of the whole result set.
  const fetchPage = async (from: number) => {
    const first = await makeQuery().range(from, from + pageSize - 1);
    if (!first.error && first.data) return first.data;
    const retry = await makeQuery().range(from, from + pageSize - 1);
    if (!retry.error && retry.data) return retry.data;
    // Completeness is this function's entire contract: callers dedupe
    // imports, decide which leads still need researching and build CSV
    // exports from it. Returning a SHORT list here (what this used to do)
    // silently re-researches done leads and truncates exports with no
    // sign anything went wrong. A thrown error is visible and retryable.
    throw new Error(
      `selectAllRows: page at offset ${from} failed — ${retry.error?.message ?? "no data returned"}`
    );
  };

  const rows: T[] = [];
  for (let windowStart = 0; ; windowStart += parallelPages) {
    const window = await Promise.all(
      Array.from({ length: parallelPages }, (_, k) =>
        fetchPage((windowStart + k) * pageSize)
      )
    );
    let last = false;
    for (const data of window) {
      rows.push(...data);
      // A short page is the final page — nothing beyond it in this window
      // (or any later one) can hold rows, so stop.
      if (data.length < pageSize) {
        last = true;
        break;
      }
    }
    if (last) break;
  }
  return rows;
}

/**
 * Escapes LIKE/ILIKE wildcards in a value that should match LITERALLY —
 * ilike is used across the codebase purely for case-insensitivity, but
 * % and _ are wildcards, and _ is common in real email addresses. An
 * unescaped `.ilike("email", addr)` can match (or scrub) a DIFFERENT
 * row than the literal address.
 */
export function escapeLike(value: string): string {
  return value.replace(/([%_\\])/g, "\\$1");
}
