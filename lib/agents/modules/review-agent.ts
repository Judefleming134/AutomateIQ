import "server-only";

import { z } from "zod";
import type { AgentModule } from "@/lib/agents/types";
import { sendReviewRequestCore } from "@/lib/review-agent/send-core";

const sendInput = z.object({
  customer_name: z.string().trim().min(1).max(120),
  customer_email: z.string().trim().email(),
});

export const reviewAgentModule: AgentModule = {
  key: "review-agent",
  name: "Review Agent",
  version: "2.0",
  category: "reputation",
  description:
    "Automates Google review requests, polite reminders and click tracking to grow your online reputation.",
  iconName: "star",
  accent: "#7C3AED",
  href: "/portal/review-agent",
  availability: "live",
  capabilities: [
    "Customer management",
    "Automated review requests",
    "3-day reminder automation",
    "Branded email templates",
    "Google review integration",
    "Click tracking & analytics",
  ],
  tools: [
    {
      name: "send_review_request",
      description:
        "Send a Google review request email to a customer. Use when the user asks to request a review from someone. Requires the customer's name and email address — ask for them if not provided. A polite reminder is sent automatically after 3 days if they don't click.",
      inputSchema: {
        type: "object",
        properties: {
          customer_name: {
            type: "string",
            description: "The customer's name, used in the email greeting.",
          },
          customer_email: {
            type: "string",
            description: "The customer's email address.",
          },
        },
        required: ["customer_name", "customer_email"],
      },
      execute: async (ctx, input) => {
        const parsed = sendInput.safeParse(input);
        if (!parsed.success) {
          return `Error: ${parsed.error.issues[0]?.message ?? "invalid input"}. Ask the user for a valid customer name and email.`;
        }
        const result = await sendReviewRequestCore(
          ctx.supabase,
          ctx.businessId,
          parsed.data.customer_name,
          parsed.data.customer_email
        );
        return result.ok
          ? `Review request sent to ${parsed.data.customer_name} (${parsed.data.customer_email}). A reminder goes out automatically in 3 days if they don't click.`
          : `Could not send: ${result.error}`;
      },
    },
    {
      name: "get_review_performance",
      description:
        "Get the business's review-request performance: totals sent, clicks, click rate, and pending reminders. Use for questions about how reviews are going.",
      inputSchema: { type: "object", properties: {} },
      execute: async (ctx) => {
        const [sent, clicked, pending] = await Promise.all([
          ctx.supabase
            .from("ra_review_requests")
            .select("id", { count: "exact", head: true })
            .in("status", ["sent", "reminded", "clicked"]),
          ctx.supabase
            .from("ra_review_requests")
            .select("id", { count: "exact", head: true })
            .eq("status", "clicked"),
          ctx.supabase
            .from("ra_review_requests")
            .select("id", { count: "exact", head: true })
            .eq("status", "sent")
            .is("reminder_sent_at", null),
        ]);
        const total = sent.count ?? 0;
        const clicks = clicked.count ?? 0;
        const rate = total > 0 ? Math.round((clicks / total) * 100) : 0;
        return `Review performance: ${total} requests sent, ${clicks} review-link clicks (${rate}% click rate). ${pending.count ?? 0} request(s) still awaiting their automatic 3-day reminder.`;
      },
    },
    {
      name: "list_recent_review_requests",
      description:
        "List the most recent review requests with customer name, status (pending/sent/reminded/clicked/failed) and date.",
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
          .from("ra_review_requests")
          .select("status, created_at, ra_customers(name, email)")
          .order("created_at", { ascending: false })
          .limit(limit);
        if (!data || data.length === 0) {
          return "No review requests have been sent yet.";
        }
        return data
          .map((r) => {
            const c = r.ra_customers as unknown as {
              name: string;
              email: string;
            } | null;
            return `${c?.name ?? "unknown"} <${c?.email ?? "?"}> — ${r.status} — ${new Date(r.created_at).toLocaleDateString("en-IE")}`;
          })
          .join("\n");
      },
    },
  ],
};
