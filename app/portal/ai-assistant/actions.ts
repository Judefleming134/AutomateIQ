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
import { logAgentRun } from "@/lib/agents/runs";
import type { AgentToolContext } from "@/lib/agents/types";
import {
  ANTHROPIC_MESSAGES_URL,
  ANTHROPIC_VERSION,
  CLAUDE_MODEL,
  geminiGenerateUrl,
  GEMINI_THINKING_OFF,
  NO_PROVIDER_MESSAGE,
  resolveProvider,
} from "@/lib/ai/config";
import { ACTION_PREFIX, type AssistantAction } from "./shared";
import { isMissingTableError, reportMissingTable } from "@/lib/db/errors";

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
  if (!enabled) return { error: "AssistIQ is not enabled for your account." };

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
    if (isMissingTableError(error)) {
      return { error: reportMissingTable("AssistIQ", "supabase/manual_update_0005.sql", error) };
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
    return { ok: false, error: "AssistIQ is not enabled for your account." };
  }

  const parsed = messageSchema.safeParse({ conversationId, text });
  if (!parsed.success) {
    return { ok: false, error: "Invalid message." };
  }

  // Provider selection is centralised in lib/ai/config.
  const provider = resolveProvider();
  if (provider.kind === "none") {
    return { ok: false, error: NO_PROVIDER_MESSAGE };
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
        isMissingTableError(convError)
          ? reportMissingTable("AssistIQ", "supabase/manual_update_0005.sql", convError)
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

  // Most-recent 30 messages, restored to chronological order — an
  // ascending limit would truncate from the WRONG end and silently drop
  // the newest turns once a conversation grows past the limit.
  const { data: historyDesc } = await supabase
    .from("aa_messages")
    .select("role, content")
    .eq("conversation_id", convId)
    .order("created_at", { ascending: false })
    .limit(30);
  // Rebuild a provider-legal transcript:
  //  - ⚙ action-chip rows are UI records, not conversation turns — replayed
  //    verbatim they produce consecutive assistant messages, which the
  //    Claude API rejects (HTTP 400) on every message after a tool-using
  //    turn.
  //  - Any remaining same-role neighbours merge into one turn.
  //  - The window must open on a user turn.
  const history: Turn[] = [];
  for (const m of (historyDesc ?? []).reverse()) {
    const content = String(m.content ?? "");
    if (content.startsWith(ACTION_PREFIX)) continue;
    const role = m.role === "assistant" ? ("assistant" as const) : ("user" as const);
    const last = history[history.length - 1];
    if (last && last.role === role) last.content += `\n\n${content}`;
    else history.push({ role, content });
  }
  while (history.length > 0 && history[0].role !== "user") {
    history.shift();
  }

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
    // Agent Framework v2: a module can contribute its own rules to the prompt.
    // No module declares `instructions` today, so this entry is an empty string
    // and .filter(Boolean) drops it — the assembled prompt is byte-for-byte
    // what it was before the field existed. Knowledge sources are named the
    // same way, so the model knows what an agent can look up rather than
    // guessing at it.
    installed
      .filter((m) => m.instructions || m.knowledgeSources?.length)
      .map((m) =>
        [
          `Agent-specific rules — ${m.name}:`,
          m.instructions,
          m.knowledgeSources?.length
            ? `It can look things up in: ${m.knowledgeSources.map((k) => `${k.label} (${k.description})`).join("; ")}.`
            : "",
        ]
          .filter(Boolean)
          .join("\n")
      )
      .join("\n\n"),
    `Rules for tools:
- When a request maps to a tool, use the tool rather than describing what the user could do manually.
- Before sending anything to a real customer (e.g. a review request), make sure you have the customer's name AND email — ask a follow-up question if either is missing. Never guess an email address.
- After acting, tell the user plainly what you did and suggest a sensible next step.
- If a task needs an agent that's still on the roadmap, say so and offer the nearest thing you CAN do today.`,
    assistant?.knowledge
      ? `Business information:\n${assistant.knowledge}`
      : `No business information has been added yet — if asked something business-specific, suggest filling in the Knowledge panel.`,
    `Never invent prices, availability or policies that aren't in the business information.`,
  ]
    // Drops the agent-instructions entry when no installed module declares any.
    // Without this the empty string would still be joined, adding a blank gap
    // to the prompt — small, but it means the prompt is genuinely unchanged
    // today rather than nearly unchanged.
    .filter(Boolean)
    .join("\n\n");

  const turns = history;

  const ctx: AgentToolContext = { businessId, supabase };
  const actions: AssistantAction[] = [];

  let reply: string;
  try {
    reply =
      provider.kind === "anthropic"
        ? await runClaude(provider.apiKey, system, turns, tools, ctx, actions)
        : await runGemini(provider.apiKey, system, turns, tools, ctx, actions);
  } catch (err) {
    console.error("Assistant API call failed:", err);
    const message = err instanceof Error ? err.message : "";
    // ACCOUNT-LEVEL failover, matching lib/ai/complete.ts: a dead Anthropic
    // account (credit balance, revoked/invalid key) fails every call the same
    // way, so answer from Gemini instead of leaving the assistant — the
    // platform's control centre — dead while research and quotes keep working.
    const accountDead =
      message.startsWith("KEY_REJECTED") ||
      /credit balance/i.test(message) ||
      /HTTP 40[13]/.test(message) ||
      (message.startsWith("HTTP 400") && /invalid_request_error/i.test(message));
    const geminiKey = process.env.GEMINI_API_KEY;
    // Only fail over if NO tool has run yet. Account-level failures normally
    // fail the very first call (nothing executed), so this is the common path.
    // But if Claude already executed a side-effecting tool (e.g. sent a review
    // request) and a LATER round then failed, re-running the whole conversation
    // on Gemini could fire that same tool AGAIN — a real double-send to the
    // customer. In that case surface an error instead of silently re-executing.
    if (provider.kind === "anthropic" && accountDead && geminiKey && actions.length === 0) {
      console.error("Assistant: Anthropic account-level failure — failing over to Gemini.");
      try {
        reply = await runGemini(geminiKey, system, turns, tools, ctx, actions);
      } catch (err2) {
        console.error("Assistant Gemini fallback also failed:", err2);
        return {
          ok: false,
          error: "The assistant couldn't respond just now — please try again.",
        };
      }
    } else {
      return {
        ok: false,
        error: message.startsWith("KEY_REJECTED")
          ? "The assistant's API key was rejected — check it in Vercel."
          : "The assistant couldn't respond just now — please try again.",
      };
    }
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

/** One transparent retry on transient upstream trouble (rate limit /
 *  server error / overloaded) before surfacing a failure. */
async function fetchWithRetry(doFetch: () => Promise<Response>): Promise<Response> {
  let res = await doFetch();
  if ([429, 500, 529].includes(res.status)) {
    await new Promise((r) => setTimeout(r, 1500));
    res = await doFetch();
  }
  return res;
}

/** A hung tool must never hang the whole assistant turn. */
const TOOL_TIMEOUT_MS = 15_000;

async function executeTool(
  tools: DiscoveredTool[],
  ctx: AgentToolContext,
  name: string,
  input: Record<string, unknown>,
  actions: AssistantAction[]
): Promise<string> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) {
    // Logged as 'denied' against the platform module: the model asked for a
    // capability this account doesn't have, which is worth seeing — it's the
    // signal that a customer is repeatedly reaching for an agent to sell them.
    void logAgentRun({
      businessId: ctx.businessId,
      agentKey: "platform",
      toolName: name,
      status: "denied",
      latencyMs: 0,
      error: "tool not available on this account",
    });
    return `Error: the "${name}" capability isn't connected on this account — the agent that provides it may not be installed. Offer what IS available instead.`;
  }
  // Every tool execution on the platform funnels through here, so this is the
  // one place the run log has to be wired. Fire-and-forget on purpose: an
  // awaited insert would add a database round-trip to every tool call inside
  // an assistant turn that already has a latency budget, and the contract in
  // lib/agents/runs.ts is that logging never affects the thing it describes.
  const startedAt = Date.now();
  try {
    const result = await Promise.race([
      tool.execute(ctx, input ?? {}),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("TOOL_TIMEOUT")), TOOL_TIMEOUT_MS)
      ),
    ]);
    void logAgentRun({
      businessId: ctx.businessId,
      agentKey: tool.agentKey,
      toolName: tool.name,
      status: "ok",
      latencyMs: Date.now() - startedAt,
    });
    actions.push({ agent: tool.agentName, tool: tool.name });
    return result;
  } catch (err) {
    console.error(`Tool ${name} failed:`, err);
    const timedOut = err instanceof Error && err.message === "TOOL_TIMEOUT";
    void logAgentRun({
      businessId: ctx.businessId,
      agentKey: tool.agentKey,
      toolName: tool.name,
      status: timedOut ? "timeout" : "error",
      latencyMs: Date.now() - startedAt,
      error: timedOut
        ? "exceeded TOOL_TIMEOUT_MS"
        : err instanceof Error
          ? err.message
          : "unknown",
    });
    return timedOut
      ? `Error: the ${tool.agentName} is taking too long to respond — tell the user it's busy and to try again in a minute.`
      : `Error: the ${tool.agentName} couldn't complete that just now.`;
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
    const res = await fetchWithRetry(() =>
      fetch(ANTHROPIC_MESSAGES_URL, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: CLAUDE_MODEL,
          // claude-sonnet-5's adaptive thinking shares this budget — 4096
          // with effort "medium" keeps thinking + tool_use JSON + the reply
          // from ever truncating mid-generation.
          max_tokens: 4096,
          output_config: { effort: "medium" },
          system,
          messages,
          ...(toolDefs.length > 0 ? { tools: toolDefs } : {}),
        }),
      })
    );

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("Anthropic API error:", res.status, detail.slice(0, 300));
      // Carry the status AND body so the caller can tell an account-level
      // failure (credit balance / invalid key) apart from a transient blip and
      // fail over to Gemini. 401 keeps its dedicated message too.
      if (res.status === 401) throw new Error(`KEY_REJECTED HTTP 401: ${detail.slice(0, 200)}`);
      throw new Error(`HTTP ${res.status}: ${detail.slice(0, 200)}`);
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
    const res = await fetchWithRetry(() =>
      fetch(geminiGenerateUrl(), {
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
          // Thinking off + real headroom: Gemini 2.5 Flash bills thinking
          // tokens against maxOutputTokens, so a tight budget with thinking
          // on can return an empty reply (finishReason MAX_TOKENS).
          generationConfig: {
            thinkingConfig: GEMINI_THINKING_OFF,
            maxOutputTokens: 2048,
          },
        }),
      })
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
