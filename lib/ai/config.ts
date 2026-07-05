/**
 * Single source of truth for the platform's LLM configuration. Every agent
 * that talks to a model (AI Assistant, Content Agent, Instant Quote Agent)
 * imports from here, so upgrading a model or endpoint is a one-line change
 * in one place instead of a hunt across the codebase.
 *
 * Provider strategy: Claude when ANTHROPIC_API_KEY is set (best quality),
 * otherwise Google Gemini's free tier (GEMINI_API_KEY) so the platform runs
 * at zero cost until the customer opts into paid inference.
 */
export const CLAUDE_MODEL = "claude-sonnet-5";
export const GEMINI_MODEL = "gemini-2.5-flash";

export const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2023-06-01";

export function geminiGenerateUrl(model: string = GEMINI_MODEL): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

/**
 * Gemini 2.5 Flash "thinks" by default and bills those tokens against
 * maxOutputTokens — with a tight budget that silently returns EMPTY text
 * (finishReason: MAX_TOKENS). These are fast, business-task generations, so
 * thinking is disabled everywhere for reliable, non-empty output.
 */
export const GEMINI_THINKING_OFF = { thinkingBudget: 0 } as const;

export type Provider =
  | { kind: "anthropic"; apiKey: string }
  | { kind: "gemini"; apiKey: string }
  | { kind: "none" };

/** Resolves which provider is configured, Claude taking precedence. */
export function resolveProvider(): Provider {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) return { kind: "anthropic", apiKey: anthropicKey };
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) return { kind: "gemini", apiKey: geminiKey };
  return { kind: "none" };
}

/** Shared "no key configured" message so every agent says the same thing. */
export const NO_PROVIDER_MESSAGE =
  "AI isn't connected yet — add an ANTHROPIC_API_KEY (or GEMINI_API_KEY) in your environment settings.";
