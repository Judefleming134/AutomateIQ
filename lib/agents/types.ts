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

/**
 * What an agent is allowed to reach, declared in the module itself.
 *
 * DECLARED AND DISPLAYED, NOT YET ENFORCED — deliberately. Eleven modules are
 * live today and none of them declares permissions; switching on enforcement
 * in the same change that introduces the field would silently break every one
 * of them. The value today is honesty: the Products page can tell a customer
 * what an agent touches before they enable it. Enforcement lands once every
 * live module declares its set, and that is a separate, verifiable change.
 */
export type AgentPermission =
  | "customers:read"
  | "customers:write"
  | "documents:read"
  | "documents:write"
  | "email:send"
  | "sms:send"
  | "quotes:write"
  | "content:write"
  | "leads:read"
  | "leads:write"
  | "analytics:read";

/**
 * Where an agent looks things up beyond the tenant's own tables — a seeded
 * catalog, a rule set, a document collection. PermitIQ's Planning Rules
 * Assistant is the first real consumer (the Irish requirements catalog); it's
 * defined here rather than there so every agent describes itself the same way.
 */
export type KnowledgeSourceRef = {
  /** Stable id, e.g. "permitiq.requirements.ie". */
  key: string;
  label: string;
  /** One line the model can be told about what's in here. */
  description: string;
};

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

  // ---- Agent Framework v2 -------------------------------------------------
  // All optional, so every module that existed before this block keeps
  // compiling and behaving identically. A module opts in field by field.

  /**
   * Agent-specific guidance appended to the AI Assistant's system prompt when
   * this module is installed. Use it for rules only this agent knows — the
   * order it needs facts in, what it must never guess, when to hand back.
   *
   * Inert until declared: no module sets this today, so the assembled prompt
   * is byte-for-byte what it was before this field existed.
   */
  instructions?: string;

  /** What this agent can reach. See AgentPermission — declared, not enforced. */
  permissions?: AgentPermission[];

  /** Catalogs or rule sets this agent reads beyond the tenant's own tables. */
  knowledgeSources?: KnowledgeSourceRef[];
};
