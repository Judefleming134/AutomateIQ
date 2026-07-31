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
 * Plain-text LLM completion shared by generative agents (ContentIQ,
 * QuoteIQ). Provider selection and model IDs come from
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
    /** Called with the provider that ACTUALLY answered — with failover live,
     *  resolveProvider() alone can't tell callers who served the response. */
    onProvider?: (provider: "anthropic" | "gemini") => void;
    /** Hard cap on the upstream call, ms. Defaults to 55s (just under the
     *  usual maxDuration=60). A caller that ALSO spends time before the call
     *  (e.g. research fetches the website first) passes a tighter value so
     *  the fetch + generation together still finish inside the 60s budget —
     *  otherwise the platform kills the whole request and the work is lost. */
    timeoutMs?: number;
    /** Optional image/PDF the model should read alongside the prompt (e.g.
     *  a photographed invoice). base64 WITHOUT the data: prefix. Supported
     *  types: image/jpeg, image/png, image/webp, application/pdf — both
     *  providers accept all four natively. */
    attachment?: { mimeType: string; dataBase64: string };
  } = {}
): Promise<string> {
  const provider = resolveProvider();
  if (provider.kind === "none") throw new Error("NO_PROVIDER");

  const timeoutMs = opts.timeoutMs ?? 55_000;

  if (provider.kind === "anthropic") {
    try {
      const text = await callAnthropic(provider.apiKey, system, prompt, maxTokens, { ...opts, timeoutMs });
      opts.onProvider?.("anthropic");
      return text;
    } catch (err) {
      // ACCOUNT-LEVEL failover: a dead Anthropic account (credit balance,
      // revoked/invalid key) fails every call identically — if a Gemini key
      // is also configured, answer from Gemini instead of failing the whole
      // platform. The Anthropic key does NOT need to be deleted for Gemini
      // to take over, and once the Anthropic account works again it wins
      // automatically (it's still tried first). Model/latency errors (429,
      // 5xx, empty output) do NOT fail over — their handling belongs to the
      // callers' retry logic.
      const msg = err instanceof Error ? err.message : "";
      const accountDead =
        /credit balance/i.test(msg) ||
        /HTTP 40[13]/.test(msg) ||
        (msg.startsWith("HTTP 400") && /invalid_request_error/i.test(msg));
      const geminiKey = process.env.GEMINI_API_KEY;
      if (accountDead && geminiKey) {
        console.error(
          "aiComplete: Anthropic account-level failure — failing over to Gemini:",
          msg.slice(0, 160)
        );
        const text = await callGemini(geminiKey, system, prompt, maxTokens, { ...opts, timeoutMs });
        opts.onProvider?.("gemini");
        return text;
      }
      throw err;
    }
  }

  const text = await callGemini(provider.apiKey, system, prompt, maxTokens, { ...opts, timeoutMs });
  opts.onProvider?.("gemini");
  return text;
}

async function callAnthropic(
  apiKey: string,
  system: string,
  prompt: string,
  maxTokens: number,
  opts: { json?: boolean; effort?: "low" | "medium" | "high"; schema?: Record<string, unknown>; timeoutMs?: number; attachment?: { mimeType: string; dataBase64: string } }
): Promise<string> {
  const outputConfig: Record<string, unknown> = {};
  if (opts.effort) outputConfig.effort = opts.effort;
  if (opts.schema)
    outputConfig.format = { type: "json_schema", schema: opts.schema };
  // With an attachment the user turn becomes content blocks: the file first
  // (image block for photos, document block for PDFs), then the instruction.
  const userContent: unknown = opts.attachment
    ? [
        opts.attachment.mimeType === "application/pdf"
          ? {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: opts.attachment.dataBase64,
              },
            }
          : {
              type: "image",
              source: {
                type: "base64",
                media_type: opts.attachment.mimeType,
                data: opts.attachment.dataBase64,
              },
            },
        { type: "text", text: prompt },
      ]
    : prompt;
  const res = await fetch(ANTHROPIC_MESSAGES_URL, {
    method: "POST",
    // Bounded: an unbounded hang burns a whole serverless invocation (and
    // can kill a cron tick mid-persist). Defaults to 55s (under every
    // caller's maxDuration=60); callers that also fetch first pass tighter.
    signal: AbortSignal.timeout(opts.timeoutMs ?? 55_000),
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: userContent }],
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

async function callGemini(
  apiKey: string,
  system: string,
  prompt: string,
  maxTokens: number,
  opts: { json?: boolean; effort?: "low" | "medium" | "high"; schema?: Record<string, unknown>; timeoutMs?: number; attachment?: { mimeType: string; dataBase64: string } }
): Promise<string> {
  // Gemini takes the file as an inline_data part ahead of the text part.
  const parts: unknown[] = opts.attachment
    ? [
        {
          inline_data: {
            mime_type: opts.attachment.mimeType,
            data: opts.attachment.dataBase64,
          },
        },
        { text: prompt },
      ]
    : [{ text: prompt }];
  const res = await fetch(geminiGenerateUrl(), {
    method: "POST",
    // Same bound as the Anthropic call — a hung request must never outlive
    // the serverless budget of the caller.
    signal: AbortSignal.timeout(opts.timeoutMs ?? 55_000),
    headers: {
      "x-goog-api-key": apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts }],
      generationConfig: {
        thinkingConfig: GEMINI_THINKING_OFF,
        maxOutputTokens: maxTokens,
        // A Claude structured-output schema implies the caller needs JSON —
        // Gemini's native JSON mode is the equivalent on failover.
        ...(opts.json || opts.schema ? { responseMimeType: "application/json" } : {}),
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
