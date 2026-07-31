import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { consume, clientIp } from "@/lib/tools/rate-limit";
import { captureToolLead } from "@/lib/growth/tool-leads";
import { ALL_TOOL_SLUGS, toolLabel } from "@/lib/tools/slugs";

export const runtime = "nodejs";

/**
 * "Send me this report" / "have us fix it" on a free tool.
 *
 * Public and unauthenticated by necessity — the whole point is that a stranger
 * who has never heard of AutomateIQ can use the tools without an account. What
 * makes that safe:
 *
 *  - the tool slug is allow-listed, so a bot can't invent a source and poison
 *    the one field the pipeline is segmented by;
 *  - every free-text field is length-capped before it reaches a note Jude will
 *    read on a call;
 *  - two rate limits, per IP and per email, because this endpoint creates rows
 *    in the CRM and an unthrottled one would fill the prospects list with junk
 *    that has to be deleted by hand.
 *
 * It never gates a result. The report is already on screen by the time this is
 * called; this is someone asking for something back.
 */

const schema = z.object({
  email: z.string().trim().min(5).max(200),
  tool: z.enum(ALL_TOOL_SLUGS as [string, ...string[]]),
  subject: z.string().trim().max(200).optional().nullable(),
  headline: z.string().trim().max(120).optional().nullable(),
  topFinding: z.string().trim().max(300).optional().nullable(),
});

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const IP_LIMIT = 6;
const IP_WINDOW = 60 * 60 * 1000;
const EMAIL_LIMIT = 4;
const EMAIL_WINDOW = 24 * 60 * 60 * 1000;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Check the details and try again." }, { status: 400 });
  }
  const { email, tool, subject, headline, topFinding } = parsed.data;
  if (!EMAIL.test(email)) {
    return NextResponse.json({ error: "That email doesn't look right." }, { status: 400 });
  }

  const ip = clientIp(request);
  if (!consume("tool-lead-ip", ip, IP_LIMIT, IP_WINDOW).allowed) {
    return NextResponse.json(
      { error: "That's a lot of requests from one place — try again later." },
      { status: 429 }
    );
  }
  if (!consume("tool-lead-email", email.toLowerCase(), EMAIL_LIMIT, EMAIL_WINDOW).allowed) {
    return NextResponse.json(
      { error: "We already have this one — we'll be in touch shortly." },
      { status: 429 }
    );
  }

  const result = await captureToolLead({
    email,
    tool,
    toolLabel: toolLabel(tool),
    subject,
    headline,
    topFinding,
  });

  if (!result.ok) {
    // Never surface the database error to a stranger, and never fail loudly:
    // they already have their report, and a red box under it would read as
    // "the tool broke" when in fact it worked perfectly.
    console.error("Tool lead capture failed:", result.error);
    return NextResponse.json({ ok: true, stored: false });
  }

  return NextResponse.json({ ok: true, stored: true });
}
