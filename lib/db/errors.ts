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

/**
 * What a PAYING CUSTOMER is told when a product's table isn't there yet.
 *
 * TWO THINGS WERE WRONG WHEREVER THIS NOW GETS CALLED, AND THEY COMPOUNDED.
 *
 * 1. Every product action tested `error.code === "42P01"` directly instead of
 *    using isMissingTableError above. Supabase's REST API does not return
 *    42P01 for a missing table — PostgREST answers PGRST205, "Could not find
 *    the table 'public.stl_settings' in the schema cache". So the check did
 *    not fire in the ordinary case and execution fell through to
 *    `return { error: error.message }`, putting that raw string on screen.
 *    The file this lives in already knew both codes; the product actions
 *    predate it and were never moved over.
 *
 * 2. When the check DID fire, it said: "Database update required — run
 *    supabase/manual_update_0007.sql." That is an instruction to a customer
 *    who has just paid for LeadIQ, naming an internal file they cannot open,
 *    on a machine they do not have. It reads as broken software, and it tells
 *    a stranger about the shape of our deployment process.
 *
 * So a customer switching on a product before its table existed saw either
 * PostgREST internals or an order to run SQL. Both say the same thing to
 * someone deciding whether to keep paying.
 *
 * The replacement names the product, makes clear it is not their fault, does
 * not pretend to be fixed, and does not leak anything. The migration filename
 * still gets recorded — see reportMissingTable — because Jude genuinely needs
 * it; it belongs in the logs, not in the customer's face.
 */
export function productSetupMessage(productName: string): string {
  return `${productName} isn't finished setting up on your account yet — nothing you did, and nothing you need to fix. We've been alerted and it's usually sorted the same working day. Everything else on your account is unaffected.`;
}

/**
 * The one call site pattern for a missing product table: record what is
 * actually needed, return what the customer should read.
 *
 * `migration` is the file that has to be run. It is logged rather than
 * returned, so the detail survives without being shown.
 */
export function reportMissingTable(
  productName: string,
  migration: string,
  error: unknown
): string {
  const detail =
    error && typeof error === "object"
      ? ((error as { message?: string }).message ?? "")
      : "";
  console.error(
    `[setup] ${productName}: missing table — run ${migration}. PostgREST said: ${detail}`
  );
  return productSetupMessage(productName);
}
