import "server-only";

import type { AgentModule } from "@/lib/agents/types";

/**
 * Platform pseudo-module: always available to every business, regardless of
 * entitlements. Gives AssistIQ cross-module awareness of the
 * business itself.
 */
export const platformModule: AgentModule = {
  key: "platform",
  name: "AutomateIQ Platform",
  version: "2.0",
  category: "platform",
  description: "Core platform services available to every business.",
  iconName: "sparkles",
  accent: "#22D3EE",
  availability: "live",
  capabilities: ["Business snapshot", "Cross-module metrics"],
  tools: [
    {
      name: "get_business_snapshot",
      description:
        "Get a live snapshot of the business across every module: leads, review requests and clicks, AI conversations, automations, and setup status. Use for 'how is my business doing' style questions or before recommending next actions.",
      inputSchema: { type: "object", properties: {} },
      execute: async (ctx) => {
        const [
          { data: business },
          { count: leads },
          { count: requests },
          { count: clicked },
          { count: conversations },
          { count: automations },
        ] = await Promise.all([
          ctx.supabase
            .from("businesses")
            .select("name, google_review_link")
            .eq("id", ctx.businessId)
            .single(),
          ctx.supabase.from("wa_leads").select("id", { count: "exact", head: true }),
          ctx.supabase
            .from("ra_review_requests")
            .select("id", { count: "exact", head: true })
            .in("status", ["sent", "reminded", "clicked"]),
          ctx.supabase
            .from("ra_review_requests")
            .select("id", { count: "exact", head: true })
            .eq("status", "clicked"),
          ctx.supabase
            .from("aa_conversations")
            .select("id", { count: "exact", head: true }),
          ctx.supabase
            .from("ra_review_requests")
            .select("id", { count: "exact", head: true })
            .not("reminder_sent_at", "is", null),
        ]);
        const total = requests ?? 0;
        const rate =
          total > 0 ? Math.round(((clicked ?? 0) / total) * 100) : 0;
        return [
          `Business: ${business?.name ?? "unknown"}`,
          `Website leads (all time): ${leads ?? 0}`,
          `Review requests: ${total} sent, ${clicked ?? 0} clicks (${rate}% click rate)`,
          `AI conversations: ${conversations ?? 0}`,
          `Automated follow-ups completed: ${automations ?? 0}`,
          `Google review link configured: ${business?.google_review_link ? "yes" : "NO — recommend adding it in Settings"}`,
        ].join("\n");
      },
    },
  ],
};
