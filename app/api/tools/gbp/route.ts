import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { checkGbp, gbpConfigured } from "@/lib/tools/gbp";
import { consume, clientIp, retryPhrase } from "@/lib/tools/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 20;

const schema = z.object({ query: z.string().trim().min(3).max(160) });

/** Each call costs a Places lookup, so this sits between the free reads and the AI. */
const LIMIT = 15;
const WINDOW = 30 * 60 * 1000;

export async function POST(request: NextRequest) {
  if (!gbpConfigured()) {
    return NextResponse.json(
      {
        error:
          "This checker isn't switched on yet — it needs a Google API key. The other free tools all work.",
        reason: "not_configured",
      },
      { status: 503 }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Enter your business name and town, e.g. “Murphy Plumbing, Blanchardstown”." },
      { status: 400 }
    );
  }

  const gate = consume("gbp", clientIp(request), LIMIT, WINDOW);
  if (!gate.allowed) {
    return NextResponse.json(
      { error: `That's a lot of checks — try again in ${retryPhrase(gate.retryInMs)}.` },
      { status: 429 }
    );
  }

  const result = await checkGbp(parsed.data.query);
  if ("error" in result) {
    const status = result.error === "not_found" ? 404 : result.error === "not_configured" ? 503 : 502;
    return NextResponse.json({ error: result.message, reason: result.error }, { status });
  }
  return NextResponse.json(result);
}
