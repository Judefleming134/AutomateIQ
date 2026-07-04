import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { aiComplete } from "@/lib/ai/complete";

export const CONTENT_TYPES = {
  blog: "a blog post (600-900 words, with a strong headline and subheadings)",
  social: "a set of 3 social media posts (each short, punchy, with relevant hashtags)",
  email: "a marketing email (subject line + body, warm and personal)",
  ad: "ad copy (3 short variants: headline + one-liner each)",
  other: "the requested piece of content",
} as const;

export type ContentType = keyof typeof CONTENT_TYPES;

export type GenerateContentResult =
  | { ok: true; content: string; saved: boolean }
  | { ok: false; error: string };

/**
 * Content Agent core, shared by the portal page and the AI Assistant's
 * generate_content tool. Caller handles auth + entitlement; `supabase` is
 * the RLS-scoped client.
 */
export async function generateContentCore(
  supabase: SupabaseClient,
  businessId: string,
  contentType: ContentType,
  topic: string,
  notes?: string
): Promise<GenerateContentResult> {
  const [{ data: business }, { data: assistant }] = await Promise.all([
    supabase.from("businesses").select("name").eq("id", businessId).single(),
    supabase
      .from("aa_assistants")
      .select("knowledge, tone")
      .eq("business_id", businessId)
      .maybeSingle(),
  ]);

  const system = [
    `You are the Content Agent for ${business?.name ?? "a small business"} — a professional copywriter who writes in their voice.`,
    `Tone: ${assistant?.tone || "friendly and professional"}.`,
    assistant?.knowledge
      ? `Business information (use it for accuracy — never invent prices or services beyond it):\n${assistant.knowledge}`
      : `No business information provided — keep specifics generic rather than inventing them.`,
    `Write ready-to-publish content. No preamble, no explanation of what you did — output only the content itself.`,
  ].join("\n\n");

  const prompt = [
    `Write ${CONTENT_TYPES[contentType]}.`,
    `Topic: ${topic}`,
    notes ? `Extra direction: ${notes}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  let content: string;
  try {
    content = await aiComplete(system, prompt, contentType === "blog" ? 3000 : 1500);
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error && err.message === "NO_PROVIDER"
          ? "The Content Agent isn't connected yet — add an ANTHROPIC_API_KEY (or GEMINI_API_KEY) in Vercel."
          : "The Content Agent couldn't write that just now — please try again.",
    };
  }
  if (!content.trim()) {
    return { ok: false, error: "The Content Agent returned nothing — try rephrasing the topic." };
  }

  // Save to the library — non-fatal if the 0007 tables haven't been
  // migrated yet: the user still gets their content.
  const { error: saveError } = await supabase.from("ca_content").insert({
    business_id: businessId,
    content_type: contentType,
    topic: topic.slice(0, 300),
    body: content,
  });

  return { ok: true, content, saved: !saveError };
}
