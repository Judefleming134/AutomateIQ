"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/require-session";
import { requireProductEnabled } from "@/lib/auth/require-product";
import { createClient } from "@/lib/supabase/server";

const knowledgeSchema = z.object({
  knowledge: z.string().trim().max(8000, "Keep the knowledge under 8000 characters"),
  tone: z.string().trim().max(120),
});

export async function updateAssistantSettings(
  _prevState: { error?: string; ok?: boolean } | undefined,
  formData: FormData
) {
  const { profile } = await requireSession();
  const businessId = profile.business_id!;

  const enabled = await requireProductEnabled(businessId, "ai-assistant");
  if (!enabled) return { error: "AI Assistant is not enabled for your account." };

  const parsed = knowledgeSchema.safeParse({
    knowledge: formData.get("knowledge") ?? "",
    tone: formData.get("tone") || "friendly and professional",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("aa_assistants").upsert(
    {
      business_id: businessId,
      knowledge: parsed.data.knowledge,
      tone: parsed.data.tone,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "business_id" }
  );

  if (error) {
    if (error.code === "42P01") {
      return { error: "Database update required — run supabase/manual_update_0005.sql (see HANDOFF.md)." };
    }
    return { error: error.message };
  }

  revalidatePath("/portal/ai-assistant");
  return { ok: true };
}

const messageSchema = z.object({
  conversationId: z.string().uuid().nullable(),
  text: z.string().trim().min(1).max(2000),
});

type ChatResult =
  | { ok: true; conversationId: string; reply: string }
  | { ok: false; error: string };

export async function sendAssistantMessage(
  conversationId: string | null,
  text: string
): Promise<ChatResult> {
  const { user, profile } = await requireSession();
  const businessId = profile.business_id!;

  const enabled = await requireProductEnabled(businessId, "ai-assistant");
  if (!enabled) {
    return { ok: false, error: "AI Assistant is not enabled for your account." };
  }

  const parsed = messageSchema.safeParse({ conversationId, text });
  if (!parsed.success) {
    return { ok: false, error: "Invalid message." };
  }

  // Provider selection: Claude when ANTHROPIC_API_KEY is set, otherwise
  // Gemini's free tier as a fallback (GEMINI_API_KEY) — lets the assistant
  // run at zero cost now and upgrade to Claude by just adding the key.
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!anthropicKey && !geminiKey) {
    return {
      ok: false,
      error:
        "The assistant isn't connected yet — add an ANTHROPIC_API_KEY (or GEMINI_API_KEY) in Vercel.",
    };
  }

  const supabase = await createClient();

  const [{ data: business }, { data: assistant }] = await Promise.all([
    supabase.from("businesses").select("name").eq("id", businessId).single(),
    supabase
      .from("aa_assistants")
      .select("knowledge, tone")
      .eq("business_id", businessId)
      .maybeSingle(),
  ]);

  // Create the conversation on first message (RLS-scoped insert).
  let convId: string | null = parsed.data.conversationId;
  if (!convId) {
    const { data: conv, error: convError } = await supabase
      .from("aa_conversations")
      .insert({
        business_id: businessId,
        title: parsed.data.text.slice(0, 60),
      })
      .select("id")
      .single();
    if (convError || !conv) {
      const hint =
        convError?.code === "42P01"
          ? "Database update required — run supabase/manual_update_0005.sql."
          : convError?.message ?? "Could not start a conversation.";
      return { ok: false, error: hint };
    }
    convId = conv.id as string;
  }
  if (!convId) {
    return { ok: false, error: "Could not start a conversation." };
  }

  // Durable user message BEFORE the external call, same pattern as the
  // Review Agent's send flow.
  await supabase.from("aa_messages").insert({
    conversation_id: convId,
    business_id: businessId,
    role: "user",
    content: parsed.data.text,
  });

  const { data: history } = await supabase
    .from("aa_messages")
    .select("role, content")
    .eq("conversation_id", convId)
    .order("created_at", { ascending: true })
    .limit(24);

  const system = [
    `You are the AI assistant for ${business?.name ?? "this business"}, embedded in their AutomateIQ portal. The person you're talking to runs the business — help them draft replies to customers, answer questions using the business information below, and suggest next steps.`,
    `Tone: ${assistant?.tone || "friendly and professional"}. Be concise — a few sentences unless more detail is genuinely needed.`,
    assistant?.knowledge
      ? `Business information:\n${assistant.knowledge}`
      : `No business information has been added yet — if asked something business-specific, suggest filling in the Knowledge panel.`,
    `Never invent prices, availability or policies that aren't in the business information.`,
  ].join("\n\n");

  const turns = (history ?? []).map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  let reply: string;
  try {
    reply = anthropicKey
      ? await callClaude(anthropicKey, system, turns)
      : await callGemini(geminiKey!, system, turns);
  } catch (err) {
    console.error("Assistant API call failed:", err);
    const message = err instanceof Error ? err.message : "";
    return {
      ok: false,
      error: message.startsWith("KEY_REJECTED")
        ? "The assistant's API key was rejected — check it in Vercel."
        : "The assistant couldn't respond just now — please try again.",
    };
  }

  await supabase.from("aa_messages").insert({
    conversation_id: convId,
    business_id: businessId,
    role: "assistant",
    content: reply,
  });

  // user variable intentionally unused beyond auth — the session check
  // itself is what matters here.
  void user;

  return { ok: true, conversationId: convId, reply };
}

type Turn = { role: "user" | "assistant"; content: string };

async function callClaude(
  apiKey: string,
  system: string,
  turns: Turn[]
): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 1024,
      system,
      messages: turns.map((t) => ({ role: t.role, content: t.content })),
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("Anthropic API error:", res.status, detail.slice(0, 300));
    throw new Error(res.status === 401 ? "KEY_REJECTED" : `HTTP ${res.status}`);
  }

  const data = (await res.json()) as {
    content: { type: string; text?: string }[];
  };
  return (
    data.content
      ?.filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("") || "…"
  );
}

async function callGemini(
  apiKey: string,
  system: string,
  turns: Turn[]
): Promise<string> {
  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: turns.map((t) => ({
          // Gemini uses "model" where Anthropic uses "assistant".
          role: t.role === "assistant" ? "model" : "user",
          parts: [{ text: t.content }],
        })),
        generationConfig: { maxOutputTokens: 1024 },
      }),
    }
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("Gemini API error:", res.status, detail.slice(0, 300));
    throw new Error(
      res.status === 400 || res.status === 401 || res.status === 403
        ? "KEY_REJECTED"
        : `HTTP ${res.status}`
    );
  }

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  return (
    data.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? "")
      .join("") || "…"
  );
}
