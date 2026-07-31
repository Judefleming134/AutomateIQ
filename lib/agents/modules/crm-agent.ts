import "server-only";

import { z } from "zod";
import type { AgentModule } from "@/lib/agents/types";

const searchInput = z.object({
  query: z.string().trim().min(1).max(120),
});

// PostgREST `or=` filters treat commas/parens as syntax — strip them from
// user input rather than trying to escape.
function sanitizeIlike(q: string) {
  return q.replace(/[,()%]/g, " ").trim();
}

export const crmAgentModule: AgentModule = {
  key: "crm-agent",
  name: "ClientIQ",
  version: "1.0",
  category: "operations",
  description:
    "A real CRM that fills itself: contacts imported from every agent, a pipeline from new to won, a full activity timeline, and follow-up tasks.",
  iconName: "contact",
  accent: "#3B82F6",
  href: "/portal/crm-agent",
  availability: "live",
  capabilities: [
    "Pipeline stages (new → won)",
    "Auto-imported from every agent",
    "Full activity timeline per contact",
    "Follow-up tasks with due dates",
    "Unified search across all sources",
  ],
  tools: [
    {
      name: "search_contacts",
      description:
        "Search the business's contacts — review customers and website leads — by name, email or phone. Use when the user asks about a specific customer or wants contact details.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Name, email or phone fragment to search for.",
          },
        },
        required: ["query"],
      },
      execute: async (ctx, input) => {
        const parsed = searchInput.safeParse(input);
        if (!parsed.success) {
          return "Error: give me a name, email or phone fragment to search for.";
        }
        const q = sanitizeIlike(parsed.data.query);
        if (!q) return "Error: that search contained no searchable characters.";

        const [{ data: customers }, { data: leads }] = await Promise.all([
          ctx.supabase
            .from("ra_customers")
            .select("name, email, created_at")
            .or(`name.ilike.%${q}%,email.ilike.%${q}%`)
            .order("created_at", { ascending: false })
            .limit(5),
          ctx.supabase
            .from("wa_leads")
            .select("name, contact, message, created_at")
            .or(`name.ilike.%${q}%,contact.ilike.%${q}%`)
            .order("created_at", { ascending: false })
            .limit(5),
        ]);

        const results = [
          ...(customers ?? []).map(
            (c) =>
              `${c.name} <${c.email}> — review customer, added ${new Date(c.created_at).toLocaleDateString("en-IE")}`
          ),
          ...(leads ?? []).map(
            (l) =>
              `${l.name} (${l.contact}) — website lead, ${new Date(l.created_at).toLocaleDateString("en-IE")}${l.message ? ` — "${String(l.message).slice(0, 100)}"` : ""}`
          ),
        ];
        return results.length === 0
          ? `No contacts matching "${q}".`
          : results.join("\n");
      },
    },
  ],
};
