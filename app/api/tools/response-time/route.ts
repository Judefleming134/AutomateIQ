import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { fetchWebsiteText } from "@/lib/growth/research";
import { getResendClient, getFromAddress } from "@/lib/email/resend";
import { consume, clientIp, retryPhrase, hostKey } from "@/lib/tools/rate-limit";
import { signToken } from "@/lib/tools/token";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * The response-time test.
 *
 * SAFETY IS THE WHOLE DESIGN HERE. A public form that emails an address of the
 * visitor's choosing is a spam cannon with AutomateIQ's name on the From line.
 * So the address is never accepted as input — it is DISCOVERED on the website
 * being tested, and it must sit on that site's own domain. You can therefore
 * only ever test a business that publishes its own contact address, which is
 * exactly the business that wants this test run.
 *
 * Two steps:
 *   "find"  — read the site, return the address we'd use (nothing is sent).
 *   "send"  — send one realistic enquiry to that address.
 *
 * The timing needs no database: the email carries a signed link whose payload
 * holds the send timestamp, so clicking it measures how long the enquiry sat
 * unseen. That IS the number that matters — a lead you haven't looked at is
 * a lead you haven't answered.
 */

const schema = z.object({
  url: z.string().trim().min(3).max(300),
  step: z.enum(["find", "send"]),
});

/** Generous for a look-up, tight for anything that actually sends. */
const FIND_LIMIT = 10;
const FIND_WINDOW = 15 * 60 * 1000;
const SEND_LIMIT = 2;
const SEND_WINDOW = 24 * 60 * 60 * 1000;

/** Addresses that are never a business's own enquiry inbox. */
const NOT_AN_INBOX =
  /^(no-?reply|do-?not-?reply|postmaster|abuse|webmaster|hostmaster|mailer-daemon|bounce)/i;

function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "https://automateiq.ie").replace(/\/+$/, "");
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter your website address." }, { status: 400 });
  }
  const { url, step } = parsed.data;
  const target = hostKey(url);
  const ip = clientIp(request);

  const findGate = consume("rt-find", ip, FIND_LIMIT, FIND_WINDOW);
  if (!findGate.allowed) {
    return NextResponse.json(
      { error: `Give it ${retryPhrase(findGate.retryInMs)} and try again.` },
      { status: 429 }
    );
  }

  // Read the site. fetchWebsiteText carries the same SSRF guard as everything
  // else here — no localhost, no private ranges, no metadata endpoints.
  const site = await fetchWebsiteText(url).catch(() => null);
  if (!site) {
    return NextResponse.json(
      {
        error:
          "Couldn't load that site — check the address, or it may be blocking automated visitors.",
      },
      { status: 422 }
    );
  }

  const found = site.found.email ?? null;
  const domain = found?.split("@")[1]?.toLowerCase() ?? "";
  const bare = target.replace(/^www\./, "");
  // The address must belong to the site being tested. A site that publishes
  // someone else's address cannot be used to send mail to that someone else.
  const sameDomain = !!domain && (domain === bare || domain.endsWith(`.${bare}`));

  if (!found || !sameDomain || NOT_AN_INBOX.test(found)) {
    return NextResponse.json(
      {
        error: !found
          ? "No email address is published on that site, so there's nothing to test. (That's worth knowing on its own — an enquiry has nowhere to land.)"
          : !sameDomain
            ? `The only address on that page (${found}) isn't on ${bare}. This test only ever writes to an address published on the site's own domain.`
            : `${found} is an automated address, not an enquiry inbox.`,
        reason: "no_testable_address",
      },
      { status: 422 }
    );
  }

  if (step === "find") {
    return NextResponse.json({ email: found, host: bare });
  }

  /* ---- send ---- */
  const sendGate = consume("rt-send", `${ip}|${bare}`, SEND_LIMIT, SEND_WINDOW);
  if (!sendGate.allowed) {
    return NextResponse.json(
      {
        error: `This test has already been run for ${bare} today. Once is the point — running it again won't tell you anything new.`,
      },
      { status: 429 }
    );
  }
  // A second, independent cap on the target alone, so the same business can't
  // be mailed repeatedly from different addresses.
  const targetGate = consume("rt-send-target", bare, 3, SEND_WINDOW);
  if (!targetGate.allowed) {
    return NextResponse.json(
      { error: `This test has already been run for ${bare} today.` },
      { status: 429 }
    );
  }

  const resend = getResendClient();
  if (!resend) {
    return NextResponse.json(
      { error: "The test can't send right now. Try again shortly." },
      { status: 503 }
    );
  }

  const token = signToken({ t: Date.now(), h: bare });
  const link = `${siteUrl()}/tools/response-time/seen?t=${encodeURIComponent(token)}`;

  const { error } = await resend.emails.send({
    from: getFromAddress(),
    to: found,
    replyTo: "hello@automateiq.ie",
    subject: "Quick question about availability",
    text: [
      "Hi,",
      "",
      "I found you online and wanted to ask about availability for a job coming up.",
      "What's your turnaround like at the moment, and roughly what would you charge?",
      "",
      "-------------------------------------------",
      "AN HONEST NOTE: this is a response-time test you asked for on",
      `${siteUrl()}/tools/response-time — it is not a real customer, and`,
      "nobody is waiting on you. It's written the way a real enquiry reads",
      "because that's the only way the test means anything.",
      "",
      "The moment you see this, click here to see how long it sat unopened:",
      link,
      "",
      "That's your real speed-to-lead. Most people are surprised by it.",
      "-------------------------------------------",
    ].join("\n"),
  });

  if (error) {
    return NextResponse.json(
      { error: "Couldn't send the test enquiry. Try again in a few minutes." },
      { status: 502 }
    );
  }

  return NextResponse.json({ sent: true, email: found });
}
