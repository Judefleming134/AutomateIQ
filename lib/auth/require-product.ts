import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * Product entitlement is enforced here, not just displayed by the portal
 * shell — every module Server Action/Route Handler must call this before
 * touching that module's tables, so a disabled/bookmarked module URL (or a
 * direct API call) can't work even if guessed. Uses the caller's own
 * session-bound client, so RLS already scopes this to their own business —
 * there's no way to pass a different business_id and check someone else's.
 */
export async function requireProductEnabled(
  businessId: string,
  productKey: string
): Promise<boolean> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("business_products")
    .select("product_id, products!inner(key)")
    .eq("business_id", businessId)
    .eq("products.key", productKey)
    .maybeSingle();

  return data !== null;
}
