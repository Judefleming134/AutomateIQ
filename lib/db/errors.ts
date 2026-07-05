/**
 * True when a Supabase/PostgREST error means the table simply doesn't exist
 * yet — i.e. the relevant manual migration hasn't been run in the SQL Editor.
 * Lets pages degrade to a clear "run migration X" message instead of throwing
 * a raw schema-cache error at the user.
 */
export function isMissingTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; message?: string };
  // 42P01 = undefined_table (direct Postgres); PGRST205 = PostgREST can't find
  // the relation in its schema cache. Message match covers both phrasings.
  return (
    e.code === "42P01" ||
    e.code === "PGRST205" ||
    /could not find the table|schema cache|relation .* does not exist/i.test(e.message ?? "")
  );
}
