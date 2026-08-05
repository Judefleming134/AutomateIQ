"use server";

import { requireGrowth } from "@/lib/growth/auth";
import { aiComplete } from "@/lib/ai/complete";

export type CaptionResult =
  | { ok: true; caption: string; imageIdea: string; hook: string }
  | { ok: false; error: string };

const SYSTEM = `You write LinkedIn posts for Jude Fleming, who runs AutomateIQ — an Irish company that builds AI agents and automation systems for small and medium businesses, mostly trades, logistics and local service companies.

His systems, all branded *IQ: ReceptionIQ (answers every call), VoiceIQ, LeadIQ (replies to enquiries in under a minute), ReputationIQ, QuoteIQ, FinanceIQ, WorkforceIQ, FleetIQ, SiteIQ (website with lead capture), PlanIQ (planning applications) and BespokeIQ for custom builds.

You are given a NEWS STORY. Write a LinkedIn post that uses it as the way in.

How the post must read:
- Like a person, not a brand. Plain Hiberno-English. Short sentences. No "thrilled to announce", no "game-changer", no "in today's fast-paced world", no "the future is here".
- Open with ONE line that stops the scroll. A fact from the story, or a blunt statement. Never a question like "Did you know?".
- Say what the story actually is in a sentence or two, honestly. Do not exaggerate it or invent detail that isn't in what you were given.
- Then the turn: what it means for an ordinary Irish business owner — a plumber, a haulier, a salon — in concrete terms. This is the whole post.
- ONE soft close. An invitation to reply or a light observation. Never "DM me", never a link dump, never hashtag spam.
- 120–200 words. Line breaks between short paragraphs — LinkedIn is read on a phone.
- At most 3 hashtags, lowercase, at the very end. Often zero is better.
- Never claim AutomateIQ was involved in the story. Never invent a customer, a statistic or a result.

Return STRICT JSON only:
{"hook":"the opening line on its own","caption":"the full post, ready to paste, including the hook","imageIdea":"one sentence: what photo Jude should take or use with this post — something he can actually get, e.g. a van, a laptop on a site, a whiteboard"}`;

/**
 * Turns a news story into a ready-to-paste LinkedIn caption.
 *
 * The story text comes from the page, not from a re-fetch: the feed already
 * gave us the title and summary, and re-reading the article would double the
 * latency for no more signal than the model needs.
 */
export async function generateCaption(
  _prev: CaptionResult | undefined,
  formData: FormData
): Promise<CaptionResult> {
  await requireGrowth();

  const title = String(formData.get("title") ?? "").trim().slice(0, 300);
  const summary = String(formData.get("summary") ?? "").trim().slice(0, 900);
  const source = String(formData.get("source") ?? "").trim().slice(0, 80);
  const link = String(formData.get("link") ?? "").trim().slice(0, 500);
  const angles = String(formData.get("angles") ?? "").trim().slice(0, 200);
  const tone = String(formData.get("tone") ?? "straight").trim();

  if (!title) return { ok: false, error: "No story selected." };

  const toneLine =
    tone === "contrarian"
      ? "TONE: take the unfashionable side. Push back on the hype in the story without being cynical for its own sake."
      : tone === "story"
        ? "TONE: open with a small concrete scene from a real working day (a missed call, a van, a Friday invoice run), then connect it to the story."
        : "TONE: straight and plain. State it, explain what it means, stop.";

  const prompt = [
    `STORY HEADLINE: ${title}`,
    source ? `SOURCE: ${source}` : "",
    summary ? `WHAT IT SAYS: ${summary}` : "",
    link ? `LINK (do NOT put this in the caption — LinkedIn buries posts with outbound links; Jude adds it as the first comment): ${link}` : "",
    angles ? `MOST RELEVANT AUTOMATEIQ SYSTEMS: ${angles}` : "",
    "",
    toneLine,
  ]
    .filter(Boolean)
    .join("\n");

  let raw: string;
  try {
    raw = await aiComplete(SYSTEM, prompt, 1400, {
      json: true,
      effort: "medium",
      timeoutMs: 45_000,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    return {
      ok: false,
      error:
        message === "NO_PROVIDER"
          ? "No AI provider configured — add ANTHROPIC_API_KEY or GEMINI_API_KEY."
          : "Couldn't write the caption just now. Try again in a moment.",
    };
  }

  // Never trust the shape: a fenced or chatty reply must degrade to a readable
  // error rather than rendering "undefined" into something he'd paste.
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) {
    return { ok: false, error: "The caption came back unreadable. Try again." };
  }
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    const caption = typeof parsed.caption === "string" ? parsed.caption.trim() : "";
    if (!caption) return { ok: false, error: "The caption came back empty. Try again." };
    return {
      ok: true,
      caption: caption.slice(0, 3000),
      hook: typeof parsed.hook === "string" ? parsed.hook.trim().slice(0, 300) : "",
      imageIdea:
        typeof parsed.imageIdea === "string" ? parsed.imageIdea.trim().slice(0, 300) : "",
    };
  } catch {
    return { ok: false, error: "The caption came back unreadable. Try again." };
  }
}
