import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { aiComplete } from "@/lib/ai/complete";
import { generateAvailability, BOOKING_CONFIG } from "@/lib/booking/slots";

/**
 * Instagram DM Setter — shared intelligence core.
 *
 * The setter is NOT a separate chatbot. It composes its system prompt from the
 * SAME business memory the AI Assistant uses (aa_assistants.knowledge + tone),
 * the SAME booking system (strategy_bookings availability + /book), and the
 * SAME LLM path (lib/ai/complete). It is the AI Assistant's intelligence,
 * pointed at Instagram lead engagement and appointment booking.
 *
 * Every function takes a Supabase client and an explicit businessId and filters
 * by business_id on every query, so it is tenant-safe whether called with the
 * caller's RLS-scoped client (portal simulator, AI Assistant tools) or the
 * service-role client (public webhook, which has no session).
 */

export type IgHistoryTurn = { direction: "inbound" | "outbound"; text: string };

type SetterContext = {
  businessName: string;
  knowledge: string | null;
  tone: string | null;
  persona: string;
  bookingLink: string;
};

function bookingLinkFor(settingsLink: string): string {
  if (settingsLink && settingsLink.trim()) return settingsLink.trim();
  const site = process.env.NEXT_PUBLIC_SITE_URL || "https://automateiq.ie";
  return `${site}/book`;
}

/** Load the shared business context the setter reasons with. */
async function loadContext(
  supabase: SupabaseClient,
  businessId: string
): Promise<SetterContext> {
  const [{ data: business }, { data: assistant }, { data: settings }] =
    await Promise.all([
      supabase.from("businesses").select("name").eq("id", businessId).maybeSingle(),
      // Shared memory: the exact knowledge base + tone the AI Assistant uses.
      supabase
        .from("aa_assistants")
        .select("knowledge, tone")
        .eq("business_id", businessId)
        .maybeSingle(),
      supabase
        .from("ig_settings")
        .select("persona, booking_link")
        .eq("business_id", businessId)
        .maybeSingle(),
    ]);

  return {
    businessName: business?.name ?? "this business",
    knowledge: assistant?.knowledge ?? null,
    tone: assistant?.tone ?? null,
    persona: settings?.persona ?? "",
    bookingLink: bookingLinkFor(settings?.booking_link ?? ""),
  };
}

function buildSystemPrompt(ctx: SetterContext): string {
  // A few upcoming open days so the setter can talk availability naturally.
  const days = generateAvailability(new Date())
    .slice(0, 5)
    .map((d) => d.dayLabel)
    .join(", ");

  return [
    `You are the Instagram DM Setter for ${ctx.businessName} — a specialist member of the AutomateIQ AI workforce, working under the business's AI Assistant. You share the AI Assistant's knowledge, memory and business context; you are the same intelligence, focused on one job: engaging Instagram DMs and booking appointments.`,
    `Your goals, in order: (1) reply warmly and helpfully like a real team member, (2) understand what the lead needs, (3) answer their questions using ONLY the business information below, (4) guide interested leads to book a free appointment.`,
    `Tone: ${ctx.tone || "friendly, warm and professional"}. Write like a real person in an Instagram DM — short, natural messages, no corporate stiffness, occasional emoji is fine. Keep each reply to 1–3 short sentences.`,
    ctx.persona ? `Extra guidance for this account: ${ctx.persona}` : null,
    `Booking: when a lead wants to book, is ready, or asks about availability, share this booking link so they can pick a time themselves: ${ctx.bookingLink}. ${days ? `Upcoming availability includes: ${days} (${BOOKING_CONFIG.timezoneLabel}).` : ""} Don't invent specific time slots — send the link and let them choose.`,
    ctx.knowledge
      ? `Business information (your single source of truth):\n${ctx.knowledge}`
      : `No business information has been added yet. Be friendly and helpful, ask what they're looking for, and offer the booking link — but never invent prices, services, availability or policies.`,
    `Never invent prices, services, availability or policies that aren't in the business information. If you don't know, say you'll check and offer to book a quick call. Never mention that you are an AI unless directly asked.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Generate the setter's next DM reply for a conversation. Reuses aiComplete,
 * so it fails the same way (NO_PROVIDER / EMPTY_OUTPUT / HTTP) and callers
 * surface a friendly message.
 */
export async function generateSetterReply(params: {
  supabase: SupabaseClient;
  businessId: string;
  history: IgHistoryTurn[];
  latestMessage: string;
}): Promise<string> {
  const ctx = await loadContext(params.supabase, params.businessId);
  const system = buildSystemPrompt(ctx);

  // Callers build `history` from the stored conversation, which by this point
  // already includes the just-received inbound message. That same message is
  // passed separately as `latestMessage` (shown below as "New message from the
  // lead"), so a trailing inbound turn that duplicates it would put the lead's
  // newest DM in the prompt twice — hurting reply quality and wasting tokens.
  // Drop that duplicate trailing turn; a no-op when a caller passes clean prior
  // history.
  let turns = params.history;
  const last = turns[turns.length - 1];
  if (last && last.direction === "inbound" && last.text === params.latestMessage) {
    turns = turns.slice(0, -1);
  }

  const transcript = turns
    .map((t) => `${t.direction === "inbound" ? "Lead" : "You"}: ${t.text}`)
    .join("\n");

  const prompt = [
    transcript ? `Conversation so far:\n${transcript}` : null,
    `New message from the lead:\n${params.latestMessage}`,
    `Write your next Instagram DM reply as ${ctx.businessName}. Reply with the message text only — no quotes, no labels.`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const reply = await aiComplete(system, prompt, 400);
  return reply.trim();
}

export type InboundResult = {
  conversationId: string;
  reply: string | null;
  autoReplied: boolean;
  /** True when a reply was generated but `deliver` reported it did NOT go out.
   *  The reply is deliberately not recorded in that case — see below. */
  deliveryFailed?: boolean;
};

/**
 * Full inbound pipeline: record the lead's message, and — when auto-reply is
 * on — generate the setter's response.
 *
 * `deliver` is how the reply actually reaches the lead. Pass it (the webhook
 * does) and the reply is recorded ONLY once delivery has confirmed. That
 * ordering matters: the reply used to be stored and the conversation marked
 * "engaged" before anyone tried to send it, and the Graph call swallowed every
 * failure — so an expired page token, a revoked permission, a rate limit or a
 * timeout left the customer's portal showing the setter's reply sitting in the
 * thread as though it had gone out, while the lead received nothing and was
 * left looking ignored. A paying customer believing the AI is handling their
 * Instagram leads while it silently isn't is the worst way this product can
 * fail.
 *
 * Omit `deliver` (the in-portal simulator) and behaviour is exactly as before:
 * there is nothing to deliver, so the reply is recorded directly.
 *
 * The residual risk is inverted and much smaller: if delivery succeeds but the
 * insert then fails, the lead got a reply we have no record of. Losing a record
 * of a message that WAS sent beats claiming one that wasn't.
 */
export async function handleInboundMessage(params: {
  supabase: SupabaseClient;
  businessId: string;
  igUserId: string;
  username?: string | null;
  text: string;
  deliver?: (reply: string) => Promise<boolean>;
}): Promise<InboundResult> {
  const { supabase, businessId, igUserId, username, text, deliver } = params;
  const now = new Date().toISOString();

  // Upsert the conversation (tenant-scoped by business_id + ig_user_id).
  const { data: existing } = await supabase
    .from("ig_conversations")
    .select("id, status")
    .eq("business_id", businessId)
    .eq("ig_user_id", igUserId)
    .maybeSingle();

  let conversationId: string;
  if (existing) {
    conversationId = existing.id as string;
    await supabase
      .from("ig_conversations")
      .update({ last_message_at: now, ...(username ? { username } : {}) })
      .eq("id", conversationId);
  } else {
    const { data: created, error } = await supabase
      .from("ig_conversations")
      .insert({
        business_id: businessId,
        ig_user_id: igUserId,
        username: username ?? null,
        status: "new",
        last_message_at: now,
      })
      .select("id")
      .single();
    if (error || !created) {
      throw new Error(error?.message ?? "Could not open the conversation.");
    }
    conversationId = created.id as string;
  }

  // Record the inbound message.
  await supabase.from("ig_messages").insert({
    conversation_id: conversationId,
    business_id: businessId,
    direction: "inbound",
    sender: "lead",
    text,
  });

  // Auto-reply toggle (defaults on when unset).
  const { data: settings } = await supabase
    .from("ig_settings")
    .select("auto_reply")
    .eq("business_id", businessId)
    .maybeSingle();
  if (settings?.auto_reply === false) {
    return { conversationId, reply: null, autoReplied: false };
  }

  // Build history (chronological) for context.
  const { data: historyDesc } = await supabase
    .from("ig_messages")
    .select("direction, text")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(20);
  const history = (historyDesc ?? []).reverse() as IgHistoryTurn[];

  const reply = await generateSetterReply({
    supabase,
    businessId,
    history,
    latestMessage: text,
  });

  // Deliver BEFORE recording, when a delivery route was supplied.
  if (deliver) {
    const delivered = await deliver(reply);
    if (!delivered) {
      // Nothing recorded and the conversation is NOT marked engaged, so it
      // keeps showing as needing attention instead of looking handled.
      console.error(
        `IG setter: reply generated but delivery failed for conversation ${conversationId} — not recorded as sent.`
      );
      return { conversationId, reply, autoReplied: false, deliveryFailed: true };
    }
  }

  await supabase.from("ig_messages").insert({
    conversation_id: conversationId,
    business_id: businessId,
    direction: "outbound",
    sender: "ai",
    text: reply,
  });
  await supabase
    .from("ig_conversations")
    .update({ status: "engaged", last_message_at: new Date().toISOString() })
    .eq("id", conversationId);

  return { conversationId, reply, autoReplied: true };
}
