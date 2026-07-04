import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * AutomateIQ modular agent framework.
 *
 * Every AI product on the platform is an AgentModule. A module declares its
 * metadata (name, version, category, capabilities), its portal surface
 * (href), and — when live — the tools it exposes to the AI Assistant.
 *
 * The AI Assistant discovers installed modules at runtime via the registry
 * (`getInstalledAgents` / `getToolsForBusiness`) and calls their tools to
 * complete tasks, so a future agent integrates by adding ONE module file
 * and one registry entry — never by changing the assistant, the shell, or
 * the navigation.
 */

export type AgentToolContext = {
  /** The caller's business — already verified by the session check. */
  businessId: string;
  /**
   * RLS-scoped Supabase server client. Every query a tool makes is
   * automatically confined to the caller's own tenant — a tool cannot
   * reach another business's data even if it tries.
   */
  supabase: SupabaseClient;
};

export type AgentTool = {
  /** Globally unique snake_case name, e.g. "send_review_request". */
  name: string;
  /** Model-facing description: what it does and when to use it. */
  description: string;
  /** JSON Schema for the tool input (object type). */
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  /**
   * Executes the tool and returns a plain-text result for the model.
   * Implementations validate their own input (zod) and must only touch
   * data through ctx.supabase.
   */
  execute: (
    ctx: AgentToolContext,
    input: Record<string, unknown>
  ) => Promise<string>;
};

export type AgentAvailability = "live" | "coming_soon" | "framework";

export type AgentModule = {
  /** Matches products.key for entitlement-gated modules. */
  key: string;
  name: string;
  version: string;
  category:
    | "platform"
    | "reputation"
    | "web"
    | "sales"
    | "operations"
    | "content"
    | "voice"
    | "finance"
    | "scheduling"
    | "support"
    | "custom";
  description: string;
  iconName: string;
  accent: string;
  /** Portal route when the module has its own UI. */
  href?: string;
  availability: AgentAvailability;
  /** Human-readable capability list, shown on the Products page. */
  capabilities: string[];
  /** Callable functions exposed to the AI Assistant (live modules only). */
  tools: AgentTool[];
};
