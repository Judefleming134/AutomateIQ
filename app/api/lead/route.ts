import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getResendClient, getFromAddress } from "@/lib/email/resend";
import { ownerNotifyRecipients } from "@/lib/email/send-booking-emails";
import { escapeLike } from "@/lib/growth/db";
import { resolveLeadSource } from "@/lib/products/marketing";

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Public marketing-site lead capture (see public/index.html's #access
 * form). Deliberately does NOT use lib/supabase/admin.ts's
 * createAdminClient() — that helper's contract is "only call from code
 * already gated by requireAdmin()", which doesn't apply here since this
 * endpoint is intentionally public. Uses its own service-role client
 * instead, same as the api/lead.js function it replaces.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const email = String(
    (body as { email?: unknown } | null)?.email ?? ""
  ).trim();

  if (!EMAIL_PATTERN.test(email)) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  // Which product page this came from, if any. Allow-listed in
  // lib/products/marketing.ts — see resolveLeadSource.
  const { source, productName } = resolveLeadSource(
    (body as { source?: unknown } | null)?.source
  );

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json(
      { error: "Server not configured" },
      { status: 500 }
    );
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Abuse guard (mirrors api/wa-lead): this endpoint emails the address typed
  // into the form, so an unthrottled bot could make automateiq.ie send
  // "access request" mail to any victim it names — and flood the owner alert.
  // Email at most once per address per 24h, checked against prior leads. The
  // lead row is still stored either way, so no genuine enquiry is dropped.
  // Matched case-INSENSITIVELY. A plain .eq() compares byte-for-byte, so
  // "Bob@x.com" didn't match the "bob@x.com" already throttled — a bot only
  // had to vary capitalisation to make automateiq.ie mail the same victim
  // over and over, which is exactly what this guard exists to stop. ilike
  // with the wildcards escaped keeps the match literal (% and _ are legal in
  // an email local part); same shape as /api/book.
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: recentLead } = await supabase
    .from("leads")
    .select("id")
    .ilike("email", escapeLike(email))
    .gte("created_at", dayAgo)
    .limit(1)
    .maybeSingle();
  const alreadyEmailedToday = Boolean(recentLead);

  const { error } = await supabase
    .from("leads")
    .insert({ email, source });

  if (error) {
    return NextResponse.json(
      { error: "Store failed", detail: error.message },
      { status: 502 }
    );
  }

  // Both emails are best-effort — the lead is already stored, so an email
  // failure must never fail the request. Skipped when this address already
  // triggered emails in the last 24h (abuse guard above).
  if (process.env.RESEND_API_KEY && !alreadyEmailedToday) {
    const resend = getResendClient();

    // 1. Confirmation to the visitor, so requesting access visibly worked.
    const sendConfirmation = async () => {
      try {
        const result = await resend.emails.send({
          from: getFromAddress(),
          to: email,
          subject: productName
            ? `Your ${productName} access request is in`
            : "Your AutomateIQ access request is in",
          text: [
            productName
              ? `Thanks for your interest in ${productName}.`
              : "Thanks for your interest in AutomateIQ.",
            "",
            "We've received your access request and a real person will be in touch shortly to get you set up.",
            "",
            // 15, not 30. Every other surface a lead touches — the outreach
            // emails, the phone script, the LinkedIn caption — promises 15
            // minutes, and this confirmation was the only one saying 30. A
            // lead could be invited to 15 and confirmed at 30 in the same
            // hour. The 45-minute calendar hold in lib/booking/slots.ts is
            // deliberately left alone: that's an internal buffer so calls
            // can't collide, not a promise anyone is shown.
            "Want to skip the queue? Book a free 15-minute AI Strategy Session and we'll map out exactly where AI and automation can save your business the most time:",
            "https://automateiq.ie/book",
            "",
            "Talk soon,",
            "AutomateIQ",
            "automateiq.ie",
          ].join("\n"),
        });
        if (result.error) {
          console.error("Lead confirmation email rejected:", result.error);
        }
      } catch (err) {
        console.error("Lead confirmation email failed:", err);
      }
    };

    // 2. Internal alert. LEAD_NOTIFY_EMAIL wins when set; otherwise the same
    // always-reachable recipients as booking alerts (admin login emails →
    // sender address), so an unconfigured alias can't swallow leads.
    const notifyOwner = async () => {
      try {
        const override = process.env.LEAD_NOTIFY_EMAIL;
        const recipients = override
          ? override.split(",").map((e) => e.trim()).filter(Boolean)
          : await ownerNotifyRecipients();
        if (recipients.length > 0) {
          const result = await resend.emails.send({
            from: getFromAddress(),
            to: recipients,
            subject: productName
              ? `New ${productName} access request — automateiq.ie`
              : "New early-access enquiry — automateiq.ie",
            text: [
              "A new enquiry just came in from the automateiq.ie website:",
              "",
              `Email: ${email}`,
              // Which page it came from. Without this, a request from the
              // PermitIQ page is indistinguishable from a homepage signup,
              // and the reply goes out talking about the wrong product.
              `Product: ${productName ?? "AutomateIQ (homepage)"}`,
              `Source: ${source}`,
              "",
              "It's also stored in the platform's leads list.",
            ].join("\n"),
          });
          if (result.error) {
            console.error("Lead enquiry notification rejected:", result.error);
          }
        }
      } catch (err) {
        console.error("Lead enquiry notification failed:", err);
      }
    };

    // Ferrari: the two emails are independent — send them in parallel to
    // shave a full email round-trip off every submit.
    await Promise.allSettled([sendConfirmation(), notifyOwner()]);
  }

  return NextResponse.json({ ok: true });
}
