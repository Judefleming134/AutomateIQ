"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/require-session";
import { requireProductEnabled } from "@/lib/auth/require-product";
import { createClient } from "@/lib/supabase/server";
import {
  getEnabledProductKeys,
  getInstalledAgents,
  getToolsForBusiness,
  AGENT_MODULES,
  type DiscoveredTool,
} from "@/lib/agents/registry";
import type { AgentToolContext } from "@/lib/agents/types";
import { ACTION_PREFIX, type AssistantAction } from "./shared";

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
  text: z.string().trim().min(1).max(4000),
});

type ChatResult =
  | {
      ok: true;
      conversationId: string;
      reply: string;
      actions: AssistantAction[];
    }
  | { ok: false; error: string };

const MAX_TOOL_ROUNDS = 5;

export async function sendAssistantMessage(
  conversationId: string | null,
  text: string
): Promise<ChatResult> {
  const { profile } = await requireSession();
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
  // Gemini's free tier as a fallback (GEMINI_API_KEY).
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

  const [{ data: business }, { data: assistant }, enabledKeys] =
    await Promise.all([
      supabase.from("businesses").select("name").eq("id", businessId).single(),
      supabase
        .from("aa_assistants")
        .select("knowledge, tone")
        .eq("business_id", businessId)
        .maybeSingle(),
      getEnabledProductKeys(supabase),
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

  // Durable user message BEFORE the external call.
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
    .limit(30);

  // ---- Dynamic agent discovery -----------------------------------------
  const tools = getToolsForBusiness(enabledKeys);
  const installed = getInstalledAgents(enabledKeys);
  const upcoming = AGENT_MODULES.filter(
    (m) => m.availability === "coming_soon"
  );

  const system = [
    `You are AutomateIQ — the AI business partner for ${business?.name ?? "this business"}, embedded in their AutomateIQ portal. The person you're talking to runs the business. You are the single control centre of their platform: you answer business questions, draft content, and USE YOUR TOOLS to actually get work done through the specialist agents installed on their account.`,
    `Tone: ${assistant?.tone || "friendly and professional"}. Be concise — a few sentences unless more detail is genuinely needed.`,
    installed.length > 0
      ? `Specialist agents installed on this account (you call them via tools — the customer never needs to switch between them):\n${installed.map((m) => `- ${m.name}: ${m.description}`).join("\n")}`
      : `No specialist agents are installed yet.`,
    `Coming soon to AutomateIQ (not yet available — if asked, say it's on the roadmap): ${upcoming.map((m) => m.name).join(", ")}.`,
    `Rules for tools:
- When a request maps to a tool, use the tool rather than describing what the user could do manually.
- Before sending anything to a real customer (e.g. a review request), make sure you have the customer's name AND email — ask a follow-up question if either is missing. Never guess an email address.
- After acting, tell the user plainly what you did and suggest a sensible next step.
- If a task needs an agent that's still on the roadmap, say so and offer the nearest thing you CAN do today.`,
    assistant?.knowledge
      ? `Business information:\n${assistant.knowledge}`
      : `No business information has been added yet — if asked something business-specific, suggest filling in the Knowledge panel.`,
    `Never invent prices, availability or policies that aren't in the business information.`,
  ].join("\n\n");

  const turns = (history ?? []).map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  const ctx: AgentToolContext = { businessId, supabase };
  const actions: AssistantAction[] = [];

  let reply: string;
  try {
    reply = anthropicKey
      ? await runClaude(anthropicKey, system, turns, tools, ctx, actions)
      : await runGemini(geminiKey!, system, turns, tools, ctx, actions);
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

  // Persist one compact action row per tool call (rendered as chips in the
  // UI, and an honest record in the model's own history), then the reply.
  for (const a of actions) {
    await supabase.from("aa_messages").insert({
      conversation_id: convId,
      business_id: businessId,
      role: "assistant",
      content: `${ACTION_PREFIX}${a.agent} · ${a.tool.replace(/_/g, " ")}`,
    });
  }
  await supabase.from("aa_messages").insert({
    conversation_id: convId,
    business_id: businessId,
    role: "assistant",
    content: reply,
  });

  return { ok: true, conversationId: convId, reply, actions };
}

type Turn = { role: "user" | "assistant"; content: string };

async function executeTool(
  tools: DiscoveredTool[],
  ctx: AgentToolContext,
  name: string,
  input: Record<string, unknown>,
  actions: AssistantAction[]
): Promise<string> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) return `Error: tool "${name}" is not available on this account.`;
  try {
    const result = await tool.execute(ctx, input ?? {});
    actions.push({ agent: tool.agentName, tool: tool.name });
    return result;
  } catch (err) {
    console.error(`Tool ${name} failed:`, err);
    return `Error: the ${tool.agentName} couldn't complete that just now.`;
  }
}

// ---- Claude (tool use) ---------------------------------------------------

type ClaudeBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

async function runClaude(
  apiKey: string,
  system: string,
  turns: Turn[],
  tools: DiscoveredTool[],
  ctx: AgentToolContext,
  actions: AssistantAction[]
): Promise<string> {
  const messages: { role: "user" | "assistant"; content: string | ClaudeBlock[] }[] =
    turns.map((t) => ({ role: t.role, content: t.content }));

  const toolDefs = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }));

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
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
        messages,
        ...(toolDefs.length > 0 ? { tools: toolDefs } : {}),
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("Anthropic API error:", res.status, detail.slice(0, 300));
      throw new Error(res.status === 401 ? "KEY_REJECTED" : `HTTP ${res.status}`);
    }

    const data = (await res.json()) as {
      stop_reason?: string;
      content: ClaudeBlock[];
    };

    const toolUses = (data.content ?? []).filter(
      (b): b is Extract<ClaudeBlock, { type: "tool_use" }> =>
        b.type === "tool_use"
    );

    if (toolUses.length === 0 || round === MAX_TOOL_ROUNDS) {
      return (
        (data.content ?? [])
          .filter((b): b is Extract<ClaudeBlock, { type: "text" }> => b.type === "text")
          .map((b) => b.text)
          .join("") || "…"
      );
    }

    // Execute every requested tool, then hand the results back.
    messages.push({ role: "assistant", content: data.content });
    const results: ClaudeBlock[] = [];
    for (const use of toolUses) {
      const output = await executeTool(tools, ctx, use.name, use.input, actions);
      results.push({ type: "tool_result", tool_use_id: use.id, content: output });
    }
    messages.push({ role: "user", content: results });
  }

  return "…";
}

// ---- Gemini (function calling) --------------------------------------------

type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: { result: string } } };

async function runGemini(
  apiKey: string,
  system: string,
  turns: Turn[],
  tools: DiscoveredTool[],
  ctx: AgentToolContext,
  actions: AssistantAction[]
): Promise<string> {
  const contents: { role: "user" | "model"; parts: GeminiPart[] }[] = turns.map(
    (t) => ({
      role: t.role === "assistant" ? "model" : "user",
      parts: [{ text: t.content }],
    })
  );

  // Gemini rejects OBJECT parameter schemas with empty `properties` —
  // no-argument tools must omit `parameters` entirely.
  const functionDeclarations = tools.map((t) => ({
    name: t.name,
    description: t.description,
    ...(Object.keys(t.inputSchema.properties).length > 0
      ? { parameters: t.inputSchema }
      : {}),
  }));

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
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
          contents,
          ...(functionDeclarations.length > 0
            ? { tools: [{ functionDeclarations }] }
            : {}),
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
      candidates?: { content?: { parts?: GeminiPart[] } }[];
    };
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const calls = parts.filter(
      (p): p is Extract<GeminiPart, { functionCall: unknown }> =>
        "functionCall" in p
    );

    if (calls.length === 0 || round === MAX_TOOL_ROUNDS) {
      return (
        parts
          .map((p) => ("text" in p ? p.text : ""))
          .join("") || "…"
      );
    }

    contents.push({ role: "model", parts });
    const responses: GeminiPart[] = [];
    for (const call of calls) {
      const output = await executeTool(
        tools,
        ctx,
        call.functionCall.name,
        call.functionCall.args ?? {},
        actions
      );
      responses.push({
        functionResponse: {
          name: call.functionCall.name,
          response: { result: output },
        },
      });
    }
    contents.push({ role: "user", parts: responses });
  }

  return "…";
}
