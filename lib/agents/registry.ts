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
import { instagramDmSetterModule } from "@/lib/agents/modules/instagram-dm-setter";
import { logisticsAgentModule } from "@/lib/agents/modules/logistics-agent";
import { voiceAgentModule } from "@/lib/agents/modules/voice-agent";
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
  instagramDmSetterModule,
  logisticsAgentModule,
  voiceAgentModule,
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

/**
 * `agentKey` rides alongside `agentName` so the run log can record a STABLE
 * identifier. agentName is display copy and can be reworded at any time —
 * grouping a month of performance history by a display string would silently
 * split an agent's stats in two the first time someone edits its label.
 */
export type DiscoveredTool = AgentTool & { agentName: string; agentKey: string };

/**
 * Connect/disconnect-aware self-knowledge: lets the Assistant answer
 * "what can you actually do?" / "is X set up?" precisely — INSTALLED vs
 * available-to-add vs coming-soon — instead of guessing from its prompt.
 * Lives in the registry (not the platform module) because it needs the
 * module list plus the caller's entitlements, and the platform module
 * importing the registry would be a cycle.
 */
function agentStatusTool(enabledKeys: Set<string>): DiscoveredTool {
  return {
    agentName: platformModule.name,
    agentKey: platformModule.key,
    name: "get_agent_status",
    description:
      "List every AutomateIQ agent with its status on THIS account — installed (callable now), available to add, or coming soon — plus what each one does. Use when asked what you can do, whether a specific agent is set up, or what the platform offers.",
    inputSchema: { type: "object", properties: {} },
    execute: async () => {
      const status = (m: AgentModule) =>
        m.availability === "live"
          ? enabledKeys.has(m.key)
            ? "INSTALLED"
            : "available to add"
          : m.availability === "coming_soon"
            ? "coming soon"
            : "in development";
      return AGENT_MODULES.map(
        (m) =>
          `- ${m.name} [${status(m)}]: ${m.description} Capabilities: ${m.capabilities.slice(0, 3).join("; ")}`
      ).join("\n");
    },
  };
}

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
  return [
    ...modules.flatMap((m) =>
      m.tools.map((t) => ({ ...t, agentName: m.name, agentKey: m.key }))
    ),
    agentStatusTool(enabledKeys),
  ];
}
