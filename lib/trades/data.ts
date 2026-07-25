import "server-only";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * Trades tool data layer. Auth + entitlement is enforced HERE (and re-checked
 * in every Server Action), not in middleware — same doctrine as /growth and
 * /portal. Every read/write uses the RLS-scoped server client, so a
 * tradesperson can only ever touch their own rows (RLS keyed to auth.uid()).
 */

export type TradesAccount = {
  id: string;
  user_id: string;
  business_name: string;
  trade: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  logo_url: string | null;
  vat_rate: number;
  vat_number: string | null;
  payment_terms_days: number;
  quote_seq: number;
  invoice_seq: number;
};

/**
 * The signed-in tradesperson and their account, creating the account row on
 * first visit (self-serve signup lands here with no account yet). Redirects to
 * the login screen when there's no session. Returns the RLS-scoped client so
 * callers keep using the same authenticated context.
 */
export async function requireTradesAccount(
  // One account system, two surfaces: TradeOS (/tradeos) and AutomateIQ
  // Finance (/finance) share the same auth + data, so a TradeOS customer
  // signing into Finance is linked automatically. The only difference is
  // which login screen an unauthenticated visitor lands on.
  loginPath: string = "/tradeos/login"
): Promise<{
  supabase: SupabaseClient;
  userId: string;
  email: string | null;
  account: TradesAccount;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(loginPath);

  const { data: existing } = await supabase
    .from("trades_accounts")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  let account = existing as TradesAccount | null;
  if (!account) {
    // First visit after signup — create their account shell. RLS's insert
    // check (user_id = auth.uid()) passes because this client IS that user.
    const { data: created, error } = await supabase
      .from("trades_accounts")
      .insert({ user_id: user.id, email: user.email ?? null })
      .select("*")
      .single();
    if (error || !created) {
      // A duplicate (race on double-load) — re-read rather than fail.
      const { data: reread } = await supabase
        .from("trades_accounts")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!reread) throw new Error(error?.message ?? "Could not create your account.");
      account = reread as TradesAccount;
    } else {
      account = created as TradesAccount;
    }
  }

  return { supabase, userId: user.id, email: user.email ?? null, account };
}

/** Onboarding is done once they've named their business. */
export function needsOnboarding(account: TradesAccount): boolean {
  return !account.business_name || account.business_name.trim().length === 0;
}
