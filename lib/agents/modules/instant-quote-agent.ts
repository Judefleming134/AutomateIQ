import "server-only";

import { z } from "zod";
import type { AgentModule } from "@/lib/agents/types";
import { createQuoteCore, formatQuoteText } from "@/lib/quote-agent/create-core";

const quoteInput = z.object({
  customer_name: z.string().trim().min(1).max(120),
  job_description: z.string().trim().min(5).max(2000),
});

export const instantQuoteAgentModule: AgentModule = {
  key: "instant-quote-agent",
  name: "Instant Quote Agent",
  version: "1.0",
  category: "sales",
  description:
    "Quote-to-close for trades: price a job from your own guide, send a branded quote the customer accepts online, and track it from sent to won.",
  iconName: "calculator",
  accent: "#EA580C",
  href: "/portal/instant-quote-agent",
  availability: "live",
  capabilities: [
    "Itemised quotations from your price guide",
    "Branded quote your customer accepts online",
    "Send, view, accept & decline tracking",
    "Won / open pipeline value + acceptance rate",
    "Automatic accept/decline notifications",
  ],
  tools: [
    {
      name: "create_quote",
      description:
        "Create an itemised quote for a customer from a job description, priced strictly from the business's own price guide, and save it to their quote history. Ask for the customer's name and the job details if missing.",
      inputSchema: {
        type: "object",
        properties: {
          customer_name: {
            type: "string",
            description: "Who the quote is for.",
          },
          job_description: {
            type: "string",
            description: "The work to be quoted, in as much detail as available.",
          },
        },
        required: ["customer_name", "job_description"],
      },
      execute: async (ctx, input) => {
        const parsed = quoteInput.safeParse(input);
        if (!parsed.success) {
          return `Error: ${parsed.error.issues[0]?.message ?? "invalid input"}.`;
        }
        const result = await createQuoteCore(
          ctx.supabase,
          ctx.businessId,
          parsed.data.customer_name,
          parsed.data.job_description
        );
        if (!result.ok) return `Could not quote: ${result.error}`;
        return `${formatQuoteText(parsed.data.customer_name, result.lines, result.total, result.notes)}\n\n(${result.saved ? "Saved to quote history." : "Note: could not save — run supabase/manual_update_0007.sql."})`;
      },
    },
  ],
};
