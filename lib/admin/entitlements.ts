import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Assigning products to a business — the write that decides what a paying
 * customer can actually see when they log in.
 *
 * Both callers used to discard the result:
 *
 *   await supabase.from("business_products").insert(...)   // error dropped
 *   return { ok: true };
 *
 * So the two worst outcomes on this path were invisible. Jude onboards a
 * customer, ticks the four products they bought, sees "Customer created" —
 * and the customer logs in to an empty portal. Or a Custom Solutions module
 * is created while the entitlement that makes it reachable silently isn't,
 * so the module exists and nobody can open it. `products.key` is the
 * entitlement foreign key, so a key that has been renamed resolves to
 * nothing and takes its product with it, quietly.
 *
 * Nothing here throws or rolls back. By the time this runs the business
 * exists and the invite has gone out; undoing that would be worse than a
 * partial assignment. The contract is that the caller is TOLD, precisely,
 * which keys did not make it — so it can say so instead of claiming success.
 */

export type EntitlementResult = {
  /** Product keys now assigned. */
  assigned: string[];
  /** Keys that resolved to no product row — usually a renamed key. */
  unknown: string[];
  /** Set when the write itself failed; assigned is then empty. */
  error: string | null;
};

/**
 * The real client type. A hand-rolled structural type here made TypeScript
 * chase Supabase's builder generics and give up with "type instantiation is
 * excessively deep" — the actual type is both simpler and honest.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

/**
 * Splits requested keys into those that exist and those that don't. Pure, so
 * the diffing that decides what Jude is told can be tested without a database.
 */
export function splitKnownKeys(
  requested: string[],
  found: { key: string }[]
): { known: string[]; unknown: string[] } {
  const have = new Set(found.map((p) => p.key));
  const seen = new Set<string>();
  const known: string[] = [];
  const unknown: string[] = [];
  for (const k of requested) {
    if (seen.has(k)) continue;
    seen.add(k);
    (have.has(k) ? known : unknown).push(k);
  }
  return { known, unknown };
}

/**
 * Builds the sentence shown to the admin. Empty string when everything landed
 * — a notice that fires on success is noise, and noise gets ignored on the
 * day it matters.
 */
export function entitlementNotice(r: EntitlementResult): string {
  if (r.error) {
    return `The account was created, but assigning products failed (${r.error}). Open the customer and set their products before telling them it's ready.`;
  }
  if (r.unknown.length > 0) {
    return `Assigned ${r.assigned.length} product${r.assigned.length === 1 ? "" : "s"}, but ${r.unknown.join(", ")} could not be found and ${r.unknown.length === 1 ? "was" : "were"} skipped. Check the customer's Products tab.`;
  }
  return "";
}

/**
 * Assigns every requested product key to a business.
 *
 * Upsert rather than insert: re-running must not fail on a product the
 * business already has, which is exactly what happens when an admin edits a
 * customer twice.
 */
export async function assignProducts(
  supabase: Client,
  businessId: string,
  keys: string[]
): Promise<EntitlementResult> {
  const requested = keys.map((k) => k.trim()).filter(Boolean);
  if (requested.length === 0) return { assigned: [], unknown: [], error: null };

  const { data: products, error: lookupError } = await supabase
    .from("products")
    .select("id, key")
    .in("key", requested);

  if (lookupError) {
    return { assigned: [], unknown: [], error: lookupError.message };
  }

  const found = products ?? [];
  const { known, unknown } = splitKnownKeys(requested, found);
  if (known.length === 0) {
    return { assigned: [], unknown, error: null };
  }

  const { error: writeError } = await supabase
    .from("business_products")
    .upsert(
      found
        .filter((p) => known.includes(p.key))
        .map((p) => ({ business_id: businessId, product_id: p.id })),
      { onConflict: "business_id,product_id" }
    );

  if (writeError) {
    return { assigned: [], unknown, error: writeError.message };
  }
  return { assigned: known, unknown, error: null };
}
