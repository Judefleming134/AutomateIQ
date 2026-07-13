import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { aiComplete } from "@/lib/ai/complete";

export type QuoteLine = { item: string; price: string };

export type CreateQuoteResult =
  | {
      ok: true;
      lines: QuoteLine[];
      total: string;
      notes: string;
      saved: boolean;
      quoteId: string | null;
    }
  | { ok: false; error: string };

/**
 * Instant Quote Agent core, shared by the portal page and the AI
 * Assistant's create_quote tool. Prices come strictly from the business's
 * own price guide — the model is instructed never to invent a price.
 */
export async function createQuoteCore(
  supabase: SupabaseClient,
  businessId: string,
  customerName: string,
  jobDescription: string,
  customerEmail?: string
): Promise<CreateQuoteResult> {
  const [{ data: business }, { data: settings }] = await Promise.all([
    supabase.from("businesses").select("name").eq("id", businessId).single(),
    supabase
      .from("qa_settings")
      .select("price_guide")
      .eq("business_id", businessId)
      .maybeSingle(),
  ]);

  if (!settings?.price_guide?.trim()) {
    return {
      ok: false,
      error:
        "Add your price guide first — the Instant Quote Agent only quotes from YOUR prices, never invented ones.",
    };
  }

  const system = [
    `You are the Instant Quote Agent for ${business?.name ?? "a business"}. You turn a job description into an itemised quote using ONLY the price guide below.`,
    `Price guide:\n${settings.price_guide}`,
    `Rules:
- Every line item's price must come from the price guide (or be a clearly labelled estimate derived from it, e.g. "2 hrs @ €95").
- If something in the job isn't covered by the price guide, put it in notes as "needs confirmation" with NO price.
- Respond with ONLY a JSON object, no markdown fences, in exactly this shape:
{"lines":[{"item":"...","price":"..."}],"total":"...","notes":"..."}`,
  ].join("\n\n");

  let raw: string;
  try {
    // json: true switches Gemini to native JSON mode on the failover path
    // (far more reliable than prompting alone) so a money quote parses cleanly
    // even when running on Gemini; effort "low" keeps a structured extraction
    // fast on Claude. Callers still parse defensively either way.
    raw = await aiComplete(system, `Job description: ${jobDescription}`, 1200, {
      json: true,
      effort: "low",
    });
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error && err.message === "NO_PROVIDER"
          ? "The Instant Quote Agent isn't connected yet — add an ANTHROPIC_API_KEY (or GEMINI_API_KEY) in Vercel."
          : "The Instant Quote Agent couldn't price that just now — please try again.",
    };
  }

  // Parse the strict-JSON reply; tolerate accidental markdown fences.
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  let lines: QuoteLine[] = [];
  let total = "";
  let notes = "";
  try {
    const parsed = JSON.parse(cleaned) as {
      lines?: { item?: unknown; price?: unknown }[];
      total?: unknown;
      notes?: unknown;
    };
    lines = (parsed.lines ?? [])
      .filter((l) => l && typeof l.item === "string")
      .map((l) => ({
        item: String(l.item),
        price: typeof l.price === "string" || typeof l.price === "number" ? String(l.price) : "",
      }));
    total = typeof parsed.total === "string" || typeof parsed.total === "number" ? String(parsed.total) : "";
    notes = typeof parsed.notes === "string" ? parsed.notes : "";
  } catch {
    // Model went off-format — keep the raw text so nothing is lost.
    notes = cleaned;
  }

  if (lines.length === 0 && !notes) {
    return { ok: false, error: "Couldn't build a quote from that description — add more detail and try again." };
  }

  const { data: inserted, error: saveError } = await supabase
    .from("qa_quotes")
    .insert({
      business_id: businessId,
      customer_name: customerName.slice(0, 120),
      customer_email: customerEmail?.slice(0, 200) || null,
      job_description: jobDescription.slice(0, 2000),
      quote_lines: lines,
      total,
      notes,
      status: "draft",
    })
    .select("id")
    .single();

  return { ok: true, lines, total, notes, saved: !saveError, quoteId: inserted?.id ?? null };
}

export function formatQuoteText(
  customerName: string,
  lines: QuoteLine[],
  total: string,
  notes: string
): string {
  return [
    `Quote for ${customerName}:`,
    ...lines.map((l) => `- ${l.item}: ${l.price}`),
    total ? `Total: ${total}` : null,
    notes ? `Notes: ${notes}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}
