import "server-only";

import {
  ANTHROPIC_MESSAGES_URL,
  ANTHROPIC_VERSION,
  CLAUDE_MODEL,
  geminiGenerateUrl,
  GEMINI_THINKING_OFF,
  resolveProvider,
} from "@/lib/ai/config";

/**
 * Plain-text LLM completion shared by generative agents (Content Agent,
 * Instant Quote Agent). Provider selection and model IDs come from
 * lib/ai/config. Throws on failure — callers surface a friendly message:
 *   - "NO_PROVIDER"  → no API key configured
 *   - "EMPTY_OUTPUT" → model returned nothing (retryable)
 *   - "HTTP <status>"→ upstream error
 *
 * Pass { json: true } when the prompt demands a JSON object back: on Gemini
 * this switches the response to native JSON mode (far more reliable than
 * prompting alone); Claude follows the prompt instruction, so it's a no-op
 * there. Callers still parse defensively either way.
 *
 * Claude-only tuning (ignored on Gemini):
 *   - effort: claude-sonnet-5 runs adaptive thinking at "high" effort when
 *     unset — deep-reasoning depth that business generations don't need and
 *     that multiplies latency. Callers state what the task deserves: "low"
 *     for drafts/rewrites, "medium" for research and proposals.
 *   - schema: a JSON Schema enforced server-side via structured outputs
 *     (output_config.format), so the response is guaranteed valid JSON in
 *     that shape — parse failures become impossible on Claude.
 */
export async function aiComplete(
  system: string,
  prompt: string,
  maxTokens = 2048,
  opts: {
    json?: boolean;
    effort?: "low" | "medium" | "high";
    schema?: Record<string, unknown>;
  } = {}
): Promise<string> {
  const provider = resolveProvider();
  if (provider.kind === "none") throw new Error("NO_PROVIDER");

  if (provider.kind === "anthropic") {
    const outputConfig: Record<string, unknown> = {};
    if (opts.effort) outputConfig.effort = opts.effort;
    if (opts.schema)
      outputConfig.format = { type: "json_schema", schema: opts.schema };
    const res = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: "POST",
      headers: {
        "x-api-key": provider.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: prompt }],
        ...(Object.keys(outputConfig).length
          ? { output_config: outputConfig }
          : {}),
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("aiComplete Anthropic error:", res.status, detail.slice(0, 300));
      throw new Error(`HTTP ${res.status}: ${detail.slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      content: { type: string; text?: string }[];
    };
    const text =
      data.content
        ?.filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("") || "";
    if (!text.trim()) throw new Error("EMPTY_OUTPUT");
    return text;
  }

  const res = await fetch(geminiGenerateUrl(), {
    method: "POST",
    headers: {
      "x-goog-api-key": provider.apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        thinkingConfig: GEMINI_THINKING_OFF,
        maxOutputTokens: maxTokens,
        ...(opts.json ? { responseMimeType: "application/json" } : {}),
      },
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("aiComplete Gemini error:", res.status, detail.slice(0, 300));
    throw new Error(`HTTP ${res.status}: ${detail.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    candidates?: {
      content?: { parts?: { text?: string }[] };
      finishReason?: string;
    }[];
  };
  const text =
    data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") || "";
  if (!text.trim()) {
    console.error(
      "aiComplete Gemini empty output, finishReason:",
      data.candidates?.[0]?.finishReason
    );
    throw new Error("EMPTY_OUTPUT");
  }
  return text;
}
