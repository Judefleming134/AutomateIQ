import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * One shared usage calculator for every agent and system on the platform, so
 * the customer Analytics page and the admin overview always agree and a new
 * agent's numbers are added in exactly one place.
 *
 * Pass an RLS-scoped client for a single business's figures, or the
 * service-role client for platform-wide totals. Every query is guarded: a
 * module whose table doesn't exist yet (its migration not run) simply reads 0,
 * so this never throws.
 */

export type AgentUsage = {
  reviewRequests: number;
  reviewClicks: number;
  reviewConversionPct: number;
  reminders: number;
  voiceJobs: number;
  leads: number;
  aiConversations: number;
  aiMessages: number;
  contentPieces: number;
  quotes: number;
  quotesAccepted: number;
  instantReplies: number;
  crmContacts: number;
  igConversations: number;
  igMessages: number;
  logDeliveries: number;
  logVehicles: number;
  logRoutes: number;
  logWarehouses: number;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
/** A head-count on one table with optional filters, guarded to 0. */
async function tableCount(
  supabase: SupabaseClient,
  table: string,
  apply?: (q: any) => any
): Promise<number> {
  try {
    let q: any = supabase.from(table).select("id", { count: "exact", head: true });
    if (apply) q = apply(q);
    const { count } = await q;
    return count ?? 0;
  } catch {
    return 0;
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function computeAgentUsage(
  supabase: SupabaseClient
): Promise<AgentUsage> {
  const [
    reviewRequests,
    reviewClicks,
    reminders,
    voiceJobs,
    leads,
    aiConversations,
    aiMessages,
    contentPieces,
    quotes,
    quotesAccepted,
    instantReplies,
    crmContacts,
    igConversations,
    igMessages,
    logDeliveries,
    logVehicles,
    logRoutes,
    logWarehouses,
  ] = await Promise.all([
    tableCount(supabase, "ra_review_requests", (q) =>
      q.in("status", ["sent", "reminded", "clicked"])
    ),
    tableCount(supabase, "ra_review_requests", (q) => q.eq("status", "clicked")),
    tableCount(supabase, "ra_review_requests", (q) =>
      q.not("reminder_sent_at", "is", null)
    ),
    tableCount(supabase, "va_jobs"),
    tableCount(supabase, "wa_leads"),
    tableCount(supabase, "aa_conversations"),
    tableCount(supabase, "aa_messages"),
    tableCount(supabase, "ca_content"),
    tableCount(supabase, "qa_quotes"),
    tableCount(supabase, "qa_quotes", (q) => q.eq("status", "accepted")),
    tableCount(supabase, "stl_replies"),
    tableCount(supabase, "crm_contacts"),
    tableCount(supabase, "ig_conversations"),
    tableCount(supabase, "ig_messages"),
    tableCount(supabase, "log_deliveries"),
    tableCount(supabase, "log_vehicles"),
    tableCount(supabase, "log_routes"),
    tableCount(supabase, "log_warehouses"),
  ]);

  const reviewConversionPct =
    reviewRequests > 0 ? Math.round((reviewClicks / reviewRequests) * 100) : 0;

  return {
    reviewRequests,
    reviewClicks,
    reviewConversionPct,
    reminders,
    voiceJobs,
    leads,
    aiConversations,
    aiMessages,
    contentPieces,
    quotes,
    quotesAccepted,
    instantReplies,
    crmContacts,
    igConversations,
    igMessages,
    logDeliveries,
    logVehicles,
    logRoutes,
    logWarehouses,
  };
}
