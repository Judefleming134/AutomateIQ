import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentModule, AgentTool } from "@/lib/agents/types";
import { platformModule } from "@/lib/agents/modules/platform";
import { reviewAgentModule } from "@/lib/agents/modules/review-agent";
import { websiteAgentModule } from "@/lib/agents/modules/website-agent";
import { contentAgentModule } from "@/lib/agents/modules/content-agent";
import { instantQuoteAgentModule } from "@/lib/agents/modules/instant-quote-agent";
import { crmAgentModule } from "@/lib/agents/modules/crm-agent";
import { speedToLeadAgentModule } from "@/lib/agents/modules/speed-to-lead-agent";
import { FUTURE_AGENT_MODULES } from "@/lib/agents/modules/future";

/**
 * Every agent module on the platform, live and upcoming. Modules register
 * here once; the AI Assistant, the Products page, and analytics all
 * discover them from this list — adding an agent never touches those
 * surfaces.
 */
export const AGENT_MODULES: AgentModule[] = [
  reviewAgentModule,
  websiteAgentModule,
  contentAgentModule,
  instantQuoteAgentModule,
  crmAgentModule,
  speedToLeadAgentModule,
  ...FUTURE_AGENT_MODULES,
];

export function getAgentByKey(key: string): AgentModule | undefined {
  if (key === platformModule.key) return platformModule;
  return AGENT_MODULES.find((m) => m.key === key);
}

/**
 * Keys of products enabled for the caller's business. Uses the RLS-scoped
 * client, so the query itself is confined to the caller's tenant.
 */
export async function getEnabledProductKeys(
  supabase: SupabaseClient
): Promise<Set<string>> {
  const { data } = await supabase
    .from("business_products")
    .select("products(key)");
  return new Set(
    (data ?? [])
      .map((r) => (r.products as unknown as { key: string } | null)?.key)
      .filter((k): k is string => Boolean(k))
  );
}

/** Live agent modules installed for this business. */
export function getInstalledAgents(enabledKeys: Set<string>): AgentModule[] {
  return AGENT_MODULES.filter(
    (m) => m.availability === "live" && enabledKeys.has(m.key)
  );
}

export type DiscoveredTool = AgentTool & { agentName: string };

/**
 * The AI Assistant's dynamic tool surface: platform tools (always on) plus
 * every tool from live, installed modules. Entitlement is enforced here —
 * a tool from a module the business doesn't have simply never reaches the
 * model.
 */
export function getToolsForBusiness(
  enabledKeys: Set<string>
): DiscoveredTool[] {
  const modules = [platformModule, ...getInstalledAgents(enabledKeys)];
  return modules.flatMap((m) =>
    m.tools.map((t) => ({ ...t, agentName: m.name }))
  );
}
