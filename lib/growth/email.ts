import "server-only";
import { getResendClient, getFromAddress } from "@/lib/email/resend";
import { ownerNotifyRecipients } from "@/lib/email/send-booking-emails";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Plain text → simple branded HTML paragraphs (outreach must read personal,
 *  not like a marketing blast, so the wrapper stays deliberately minimal). */
function bodyToHtml(body: string): string {
  const paragraphs = escapeHtml(body)
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px;">${p.replace(/\n/g, "<br/>")}</p>`)
    .join("");
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:600px;">${paragraphs}</div>`;
}

/**
 * Cold outreach sends from Jude personally — replies land in jude@'s Gmail
 * where he works them, and a named human sender opens far better than a
 * brand. Overridable via GROWTH_FROM_EMAIL without a deploy. Falls back to
 * the platform-wide sender only if the domain isn't verified yet.
 */
function outreachFromAddress(): string {
  const configured = process.env.GROWTH_FROM_EMAIL;
  if (configured) return configured;
  // Sending as jude@ requires the verified automateiq.ie domain in Resend;
  // RESEND_FROM_EMAIL being an automateiq.ie address signals that.
  if ((process.env.RESEND_FROM_EMAIL ?? "").includes("automateiq.ie")) {
    return "Jude at AutomateIQ <jude@automateiq.ie>";
  }
  return getFromAddress();
}

/**
 * Sends an outreach email through Resend (the one channel with a first-class
 * official sending API in this stack). Returns an error string instead of
 * throwing so callers can mark the message row 'failed' with a reason.
 */
export async function sendOutreachEmail(params: {
  to: string;
  subject: string;
  body: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const resend = getResendClient();
    const { error } = await resend.emails.send({
      from: outreachFromAddress(),
      to: params.to,
      subject: params.subject,
      replyTo: "jude@automateiq.ie",
      text: params.body,
      html: bodyToHtml(params.body),
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Email send failed.",
    };
  }
}

/**
 * Best-effort internal alert (new meeting recorded, booking synced…) to the
 * same recipients the public booking system notifies — admins are told about
 * Growth Engine bookings exactly like website bookings. Never throws.
 */
export async function notifyGrowthTeam(
  subject: string,
  detailLines: string[]
): Promise<void> {
  try {
    const recipients = await ownerNotifyRecipients();
    if (recipients.length === 0) return;
    const body = detailLines.join("\n");
    const resend = getResendClient();
    await resend.emails.send({
      from: getFromAddress(),
      to: recipients,
      subject,
      text: body,
      html: bodyToHtml(body),
    });
  } catch (err) {
    console.error("Growth Engine notification failed:", err);
  }
}
