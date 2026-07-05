import "server-only";

/**
 * Plain-text LLM completion shared by generative agents (Content Agent,
 * Instant Quote Agent). Same provider strategy as the AI Assistant:
 * Claude when ANTHROPIC_API_KEY is set, Gemini free tier as fallback.
 * Throws on failure — callers surface a friendly message.
 */
export async function aiComplete(
  system: string,
  prompt: string,
  maxTokens = 2048
): Promise<string> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!anthropicKey && !geminiKey) {
    throw new Error("NO_PROVIDER");
  }

  if (anthropicKey) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("aiComplete Anthropic error:", res.status, detail.slice(0, 300));
      throw new Error(`HTTP ${res.status}`);
    }
    const data = (await res.json()) as {
      content: { type: string; text?: string }[];
    };
    return (
      data.content
        ?.filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("") || ""
    );
  }

  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    {
      method: "POST",
      headers: {
        "x-goog-api-key": geminiKey!,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          // Gemini 2.5 Flash "thinks" by default, and those thinking
          // tokens are billed against maxOutputTokens — leaving thinking on
          // with a tight budget makes the model return an empty response
          // (finishReason: MAX_TOKENS, no text). These are fast,
          // deterministic generation tasks, so turn thinking off and give
          // the output real headroom.
          thinkingConfig: { thinkingBudget: 0 },
          maxOutputTokens: maxTokens,
        },
      }),
    }
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("aiComplete Gemini error:", res.status, detail.slice(0, 300));
    throw new Error(`HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    candidates?: {
      content?: { parts?: { text?: string }[] };
      finishReason?: string;
    }[];
  };
  const text =
    data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ||
    "";
  if (!text.trim()) {
    console.error(
      "aiComplete Gemini empty output, finishReason:",
      data.candidates?.[0]?.finishReason
    );
    throw new Error("EMPTY_OUTPUT");
  }
  return text;
}
