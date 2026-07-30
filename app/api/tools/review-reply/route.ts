import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { aiComplete } from "@/lib/ai/complete";
import { consume, clientIp, retryPhrase } from "@/lib/tools/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 45;

const bodySchema = z.object({
  review: z.string().trim().min(15).max(2000),
  business: z.string().trim().max(120).optional(),
  rating: z.number().int().min(1).max(5).optional(),
});

/**
 * Free review-reply writer. This one spends real money per call, so it carries
 * a tighter limit than the read-only tools: six a day per address is plenty for
 * a real business clearing a backlog of reviews, and useless to anyone trying
 * to use the endpoint as free inference.
 */
const DAILY_LIMIT = 6;
const DAY_MS = 24 * 60 * 60 * 1000;

const SYSTEM = `You write replies to online customer reviews on behalf of small Irish businesses (trades, salons, restaurants, garages, clinics).

Rules, all of them non-negotiable:
- Write in plain Hiberno-English. No corporate voice, no "we sincerely apologise for any inconvenience caused", no "your feedback is important to us".
- Never invent facts. You do not know what happened. Do not claim to have records, refunds, dates, staff names or a version of events.
- Never argue, never blame the customer, never get defensive — even when the review is unfair. A defensive reply is read by hundreds of future customers, and it costs far more than the one bad review did.
- Keep it short. 2 to 4 sentences. Long replies read as guilt.
- For a negative review: acknowledge specifically what they raised, take responsibility for the experience without admitting to facts you can't verify, and move it offline with a real next step.
- For a positive review: thank them for something specific they actually mentioned. Never ask for anything in return.
- Sign off as the business, not as an individual, unless a name is given.
- No emoji unless the review itself uses them.

Return STRICT JSON only:
{"replies":[{"tone":"Warm and personal","text":"..."},{"tone":"Short and professional","text":"..."},{"tone":"Firm but fair","text":"..."}],"read":"one sentence on what this reviewer actually wants","warning":"a caution if the review alleges something serious (safety, legal, discrimination, injury) that needs a human and possibly legal advice before ANY public reply — otherwise empty string"}`;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Paste the review you want to reply to — at least a sentence of it." },
      { status: 400 }
    );
  }

  const gate = consume("review-reply", clientIp(request), DAILY_LIMIT, DAY_MS);
  if (!gate.allowed) {
    return NextResponse.json(
      {
        error: `That's ${DAILY_LIMIT} replies today — the tool is free but it isn't bottomless. Try again in ${retryPhrase(
          gate.retryInMs
        )}, or talk to us about doing this automatically for every review you get.`,
      },
      { status: 429 }
    );
  }

  const { review, business, rating } = parsed.data;
  const prompt = [
    business ? `Business: ${business}` : "Business: (not given — keep the reply generic)",
    rating ? `Star rating: ${rating} out of 5` : "Star rating: not given — judge from the text",
    "",
    "The review:",
    review,
  ].join("\n");

  let raw: string;
  try {
    raw = await aiComplete(SYSTEM, prompt, 1200, {
      json: true,
      effort: "low",
      timeoutMs: 35_000,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message === "NO_PROVIDER") {
      return NextResponse.json(
        { error: "The writer is offline right now. Try again shortly." },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { error: "Couldn't write the replies just now — give it a minute and try again." },
      { status: 502 }
    );
  }

  // The model is instructed to return strict JSON, but a public endpoint can't
  // assume it did — a fenced or chatty response must not 500 the page.
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  let data: unknown = null;
  if (start !== -1 && end > start) {
    try {
      data = JSON.parse(raw.slice(start, end + 1));
    } catch {
      data = null;
    }
  }

  const shape = z.object({
    replies: z
      .array(z.object({ tone: z.string().max(60), text: z.string().min(1).max(1500) }))
      .min(1)
      .max(4),
    read: z.string().max(400).optional().default(""),
    warning: z.string().max(600).optional().default(""),
  });
  const checked = shape.safeParse(data);
  if (!checked.success) {
    return NextResponse.json(
      { error: "The reply came back in a shape we couldn't read. Try again." },
      { status: 502 }
    );
  }

  return NextResponse.json(checked.data);
}
