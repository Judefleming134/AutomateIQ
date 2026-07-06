import "server-only";

import { z } from "zod";
import type { AgentModule } from "@/lib/agents/types";
import { generateSetterReply, type IgHistoryTurn } from "@/lib/instagram/setter-core";

const readInput = z.object({
  username: z.string().trim().min(1).max(120),
});
const draftInput = z.object({
  username: z.string().trim().min(1).max(120).optional(),
  conversationId: z.string().uuid().optional(),
});

function sanitizeIlike(q: string) {
  return q.replace(/[,()%]/g, " ").trim();
}

/**
 * Instagram DM Setter — registered as a specialist agent in the AutomateIQ
 * ecosystem. The AI Assistant discovers these tools automatically (via the
 * registry) and delegates Instagram work to them, keeping full visibility over
 * the conversations and outcomes. The setter's replies come from the shared
 * intelligence core (lib/instagram/setter-core), so the Assistant and the
 * setter are one mind, not two.
 */
export const instagramDmSetterModule: AgentModule = {
  key: "instagram-dm-setter",
  name: "Instagram DM Setter",
  version: "1.0",
  category: "sales",
  description:
    "Engages Instagram DMs, answers questions in your brand voice and books appointments — coordinated by your AI Assistant, sharing its knowledge, CRM and booking system.",
  iconName: "instagram",
  accent: "#E1306C",
  href: "/portal/instagram-dm-setter",
  // Shown as "Coming soon" until the Instagram/Facebook account is connected.
  // To go live: change this to "live" and redeploy — everything else (page,
  // webhook, tools, migration 0011) is already in place and ready.
  availability: "coming_soon",
  capabilities: [
    "Replies to Instagram DMs in your brand voice",
    "Shares the AI Assistant's business knowledge & memory",
    "Books appointments through your booking system",
    "Full conversation history, working 24/7",
    "The AI Assistant can read and draft DMs on your behalf",
  ],
  tools: [
    {
      name: "list_instagram_conversations",
      description:
        "List the most recent Instagram DM conversations the setter is handling, with each lead's username, status and last message. Use when the user asks about Instagram leads or DM activity.",
      inputSchema: { type: "object", properties: {} },
      execute: async (ctx) => {
        const { data: convos } = await ctx.supabase
          .from("ig_conversations")
          .select("username, ig_user_id, status, last_message_at")
          .order("last_message_at", { ascending: false })
          .limit(10);
        if (!convos || convos.length === 0) {
          return "No Instagram conversations yet. Once the Instagram DM Setter is connected (or you run a test in the portal), leads will appear here.";
        }
        return convos
          .map(
            (c) =>
              `@${c.username ?? c.ig_user_id} — ${c.status}, last message ${new Date(
                c.last_message_at
              ).toLocaleString("en-IE")}`
          )
          .join("\n");
      },
    },
    {
      name: "read_instagram_conversation",
      description:
        "Read the full message history of one Instagram DM conversation, by the lead's username. Use to review what was said before drafting a reply or answering the user.",
      inputSchema: {
        type: "object",
        properties: {
          username: {
            type: "string",
            description: "The lead's Instagram username (with or without @).",
          },
        },
        required: ["username"],
      },
      execute: async (ctx, input) => {
        const parsed = readInput.safeParse(input);
        if (!parsed.success) return "Error: give me the lead's Instagram username.";
        const uname = sanitizeIlike(parsed.data.username.replace(/^@/, ""));
        if (!uname) return "Error: that username had no searchable characters.";

        const { data: convo } = await ctx.supabase
          .from("ig_conversations")
          .select("id, username, ig_user_id, status")
          .or(`username.ilike.%${uname}%,ig_user_id.ilike.%${uname}%`)
          .order("last_message_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!convo) return `No Instagram conversation found for "@${uname}".`;

        const { data: messages } = await ctx.supabase
          .from("ig_messages")
          .select("direction, text, created_at")
          .eq("conversation_id", convo.id)
          .order("created_at", { ascending: true })
          .limit(40);

        const lines = (messages ?? []).map(
          (m) => `${m.direction === "inbound" ? "Lead" : "Setter"}: ${m.text}`
        );
        return `Conversation with @${convo.username ?? convo.ig_user_id} (${convo.status}):\n${
          lines.join("\n") || "(no messages)"
        }`;
      },
    },
    {
      name: "draft_instagram_reply",
      description:
        "Draft the setter's next Instagram DM reply for a conversation, using the shared business knowledge and booking system. Use when the user asks you to reply to, or suggest a response for, an Instagram lead. Returns a suggested message; it is not sent automatically.",
      inputSchema: {
        type: "object",
        properties: {
          username: {
            type: "string",
            description: "The lead's Instagram username to draft a reply for.",
          },
          conversationId: {
            type: "string",
            description: "Optional conversation id if already known.",
          },
        },
      },
      execute: async (ctx, input) => {
        const parsed = draftInput.safeParse(input);
        if (!parsed.success) return "Error: tell me which Instagram lead to reply to.";

        let conversationId = parsed.data.conversationId;
        if (!conversationId && parsed.data.username) {
          const uname = sanitizeIlike(parsed.data.username.replace(/^@/, ""));
          const { data: convo } = await ctx.supabase
            .from("ig_conversations")
            .select("id")
            .or(`username.ilike.%${uname}%,ig_user_id.ilike.%${uname}%`)
            .order("last_message_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          conversationId = convo?.id;
        }
        if (!conversationId) {
          return "I couldn't find that Instagram conversation. Give me the lead's username.";
        }

        const { data: messages } = await ctx.supabase
          .from("ig_messages")
          .select("direction, text")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: true })
          .limit(20);
        const history = (messages ?? []) as IgHistoryTurn[];
        const lastInbound = [...history].reverse().find((m) => m.direction === "inbound");
        if (!lastInbound) {
          return "There's no message from the lead to reply to yet.";
        }

        try {
          const reply = await generateSetterReply({
            supabase: ctx.supabase,
            businessId: ctx.businessId,
            history,
            latestMessage: lastInbound.text,
          });
          return `Suggested Instagram reply:\n${reply}`;
        } catch (err) {
          const msg = err instanceof Error ? err.message : "";
          if (msg === "NO_PROVIDER") {
            return "I can't draft a reply — no AI provider key is configured for the account.";
          }
          return "I couldn't draft a reply just now — please try again.";
        }
      },
    },
    {
      name: "instagram_setter_stats",
      description:
        "Get Instagram DM Setter stats: number of conversations, how many are engaged or booked, and total messages handled. Use for questions about Instagram performance.",
      inputSchema: { type: "object", properties: {} },
      execute: async (ctx) => {
        const [{ count: convos }, { count: messages }, { data: statuses }] =
          await Promise.all([
            ctx.supabase.from("ig_conversations").select("id", { count: "exact", head: true }),
            ctx.supabase.from("ig_messages").select("id", { count: "exact", head: true }),
            ctx.supabase.from("ig_conversations").select("status"),
          ]);
        if ((convos ?? 0) === 0) {
          return "No Instagram conversations yet.";
        }
        const engaged = (statuses ?? []).filter((s) => s.status === "engaged").length;
        const booked = (statuses ?? []).filter((s) => s.status === "booked").length;
        return `Instagram DM Setter: ${convos} conversation(s), ${messages} message(s) handled, ${engaged} engaged, ${booked} booked.`;
      },
    },
  ],
};
