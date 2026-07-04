import "server-only";

import type { AgentModule } from "@/lib/agents/types";

export const websiteAgentModule: AgentModule = {
  key: "website-agent",
  name: "Website Agent",
  version: "2.0",
  category: "web",
  description:
    "A hosted, conversion-focused business page with built-in lead capture — enquiries land straight in the portal.",
  iconName: "globe",
  accent: "#3B82F6",
  href: "/portal/website-agent",
  availability: "live",
  capabilities: [
    "Hosted business page",
    "Lead capture forms",
    "Lead inbox & notifications",
    "Content management",
    "Publish controls",
    "Lead analytics",
  ],
  tools: [
    {
      name: "get_website_overview",
      description:
        "Get the business's website status: whether the page is published, its public URL, and total leads captured. Use for questions about the website.",
      inputSchema: { type: "object", properties: {} },
      execute: async (ctx) => {
        const [{ data: page }, { count: leads }] = await Promise.all([
          ctx.supabase
            .from("wa_pages")
            .select("slug, published, headline")
            .eq("business_id", ctx.businessId)
            .maybeSingle(),
          ctx.supabase
            .from("wa_leads")
            .select("id", { count: "exact", head: true }),
        ]);
        if (!page) {
          return "No website page has been set up yet — the user can create one in the Website Agent.";
        }
        const siteUrl =
          process.env.NEXT_PUBLIC_SITE_URL || "https://automateiq.ie";
        return [
          `Status: ${page.published ? "LIVE" : "draft (not published)"}`,
          `URL: ${siteUrl}/b/${page.slug}`,
          page.headline ? `Headline: ${page.headline}` : null,
          `Leads captured (all time): ${leads ?? 0}`,
        ]
          .filter(Boolean)
          .join("\n");
      },
    },
    {
      name: "list_recent_leads",
      description:
        "List the most recent website leads (name, email, phone, message, date). Use when the user asks about their leads or enquiries.",
      inputSchema: {
        type: "object",
        properties: {
          limit: {
            type: "integer",
            description: "How many to return (default 5, max 10).",
          },
        },
      },
      execute: async (ctx, input) => {
        const limit = Math.min(Math.max(Number(input.limit) || 5, 1), 10);
        const { data } = await ctx.supabase
          .from("wa_leads")
          .select("name, email, phone, message, created_at")
          .order("created_at", { ascending: false })
          .limit(limit);
        if (!data || data.length === 0) {
          return "No website leads yet.";
        }
        return data
          .map(
            (l) =>
              `${l.name} <${l.email}>${l.phone ? ` ${l.phone}` : ""} — ${new Date(l.created_at).toLocaleDateString("en-IE")}${l.message ? ` — "${String(l.message).slice(0, 140)}"` : ""}`
          )
          .join("\n");
      },
    },
  ],
};
