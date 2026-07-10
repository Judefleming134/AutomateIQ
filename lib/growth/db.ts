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
 * loop guarantees completeness at any table size.
 *
 * `makeQuery` MUST return a fresh builder each call — a builder is single-use
 * once it has been ranged/awaited.
 */
export async function selectAllRows<T>(
  makeQuery: () => Rangeable<T>,
  pageSize = 1000
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await makeQuery().range(from, from + pageSize - 1);
    if (error || !data) break;
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}
