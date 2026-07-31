import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The agent run log — Agent Framework v2's Logs and Performance tracking.
 *
 * The framework described what each agent IS but kept no record of what any
 * agent DID, so "did that actually run?", "how slow is the quote agent?" and
 * "which tool keeps failing?" were unanswerable across eleven live agents.
 * One row per tool execution answers all three for every module at once.
 *
 * Two rules, both deliberate:
 *
 * 1. BEST-EFFORT. A logging failure must never fail, delay or alter the tool
 *    it describes. Every error is swallowed with a console.error — same
 *    contract as lib/audit.ts, for the same reason.
 * 2. NO PAYLOADS. Tool input and output routinely carry customer names, email
 *    addresses and quote figures. A debug log is the wrong place for personal
 *    data to accumulate, so this records THAT a call happened, how it went and
 *    how long it took — never what was in it. The business data stays in the
 *    module's own tables where RLS already governs it.
 *
 * Writes use the service-role client: agent_runs has a select policy for
 * members and no insert policy at all, so a tenant can read its own history
 * and nothing but the platform can write it.
 */

export type AgentRunStatus = "ok" | "error" | "timeout" | "denied";

/** Keeps a stray stack trace or payload out of the `error` column. */
const MAX_ERROR_CHARS = 300;

export async function logAgentRun(params: {
  businessId: string;
  agentKey: string;
  toolName: string;
  status: AgentRunStatus;
  latencyMs: number;
  error?: string | null;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("agent_runs").insert({
      business_id: params.businessId,
      agent_key: params.agentKey,
      tool_name: params.toolName,
      status: params.status,
      // The CHECK rejects a negative, and a clock skew shouldn't be the thing
      // that loses the row.
      latency_ms: Math.max(0, Math.round(params.latencyMs)),
      error: params.error ? params.error.slice(0, MAX_ERROR_CHARS) : null,
    });
    if (error) {
      // Includes the case where migration 0032 hasn't been applied yet: the
      // insert fails, the agent still works, and the reason is in the logs
      // rather than silently absent.
      console.error("agent_runs insert failed:", error.message, params.toolName);
    }
  } catch (err) {
    console.error("agent_runs logging threw:", err);
  }
}
