import "server-only";

import type { AgentModule } from "@/lib/agents/types";

export const speedToLeadAgentModule: AgentModule = {
  key: "speed-to-lead-agent",
  name: "LeadIQ",
  version: "1.0",
  category: "sales",
  description:
    "Replies to every new website lead in under 60 seconds with a personal acknowledgment — day or night.",
  iconName: "zap",
  accent: "#F59E0B",
  href: "/portal/speed-to-lead-agent",
  availability: "live",
  capabilities: [
    "Instant lead acknowledgment",
    "Works 24/7 automatically",
    "Personalised with your business details",
    "Full reply log",
  ],
  tools: [
    {
      name: "get_lead_response_stats",
      description:
        "Get LeadIQ's stats: how many instant replies it has sent and when the last one went out. Use for questions about lead response.",
      inputSchema: { type: "object", properties: {} },
      execute: async (ctx) => {
        const [{ count }, { data: last }] = await Promise.all([
          ctx.supabase
            .from("stl_replies")
            .select("id", { count: "exact", head: true }),
          ctx.supabase
            .from("stl_replies")
            .select("sent_to, created_at")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);
        if ((count ?? 0) === 0) {
          return "No instant replies sent yet — they fire automatically the moment a lead with an email address comes in through the website.";
        }
        return `Instant replies sent: ${count}. Last one: ${last ? `${new Date(last.created_at).toLocaleString("en-IE")} to ${last.sent_to}` : "unknown"}. Every reply goes out within 60 seconds of the lead arriving.`;
      },
    },
  ],
};
