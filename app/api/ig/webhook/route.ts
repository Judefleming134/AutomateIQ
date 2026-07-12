import { NextResponse, type NextRequest } from "next/server";
import crypto from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleInboundMessage } from "@/lib/instagram/setter-core";

/**
 * Instagram DM Setter webhook.
 *
 * Public endpoint (visitors/Meta have no session) — routes each inbound DM to
 * the right business by the recipient IG account id, then runs the shared
 * setter pipeline (store → AI reply via the AI Assistant's intelligence →
 * store) and delivers the reply through the Graph API using that business's
 * stored page token. Best-effort and idempotent-friendly: it always answers
 * Meta with a fast 200 so deliveries aren't retried into duplicates.
 *
 * GET  — Meta subscription verification (hub.challenge).
 * POST — message events.
 *
 * Setup env: INSTAGRAM_VERIFY_TOKEN (the token you enter in the Meta app's
 * webhook config) and INSTAGRAM_APP_SECRET (the Meta app secret, used to
 * verify each POST's X-Hub-Signature-256). Per-business page tokens live in
 * ig_settings, not env.
 *
 * SECURITY: without signature verification, anyone who learns a business's
 * ig_account_id could POST forged DMs and make the AI send replies from that
 * business's account. So when INSTAGRAM_APP_SECRET is set, a POST whose
 * X-Hub-Signature-256 doesn't match the raw body is rejected. Until the
 * secret is configured the endpoint still processes (so an existing setup is
 * never broken) but logs that it's running unverified — set the secret to
 * close the gap.
 */

/**
 * Verifies Meta's X-Hub-Signature-256 (HMAC-SHA256 of the raw body, keyed by
 * the app secret). Returns "ok"/"bad" when a secret is configured, or
 * "unconfigured" when it isn't (caller processes but warns).
 */
function verifyIgSignature(
  request: NextRequest,
  rawBody: string
): "ok" | "bad" | "unconfigured" {
  const secret = process.env.INSTAGRAM_APP_SECRET;
  if (!secret) return "unconfigured";
  const header = request.headers.get("x-hub-signature-256") ?? "";
  const [algo, sig] = header.split("=");
  if (algo !== "sha256" || !sig) return "bad";
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  try {
    const a = Buffer.from(sig, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length) return "bad";
    return crypto.timingSafeEqual(a, b) ? "ok" : "bad";
  } catch {
    return "bad";
  }
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  const expected = process.env.INSTAGRAM_VERIFY_TOKEN;
  if (mode === "subscribe" && expected && token === expected) {
    return new Response(challenge ?? "", {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  }
  return new Response("Forbidden", { status: 403 });
}

type MessagingEvent = {
  sender?: { id?: string };
  recipient?: { id?: string };
  message?: { text?: string; is_echo?: boolean };
};

async function sendInstagramReply(
  pageToken: string,
  recipientIgUserId: string,
  text: string
) {
  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/me/messages?access_token=${encodeURIComponent(pageToken)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          recipient: { id: recipientIgUserId },
          message: { text },
        }),
      }
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("Instagram send failed:", res.status, detail.slice(0, 300));
    }
  } catch (err) {
    console.error("Instagram send error:", err);
  }
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  // Reject forged events once the app secret is set; process-but-warn until
  // then so a live setup is never broken by the new check.
  const sigState = verifyIgSignature(request, rawBody);
  if (sigState === "bad") {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }
  if (sigState === "unconfigured") {
    console.warn(
      "IG webhook: processing UNVERIFIED — set INSTAGRAM_APP_SECRET to enforce X-Hub-Signature-256."
    );
  }

  let body: { entry?: { messaging?: MessagingEvent[] }[] } | null;
  try {
    body = JSON.parse(rawBody);
  } catch {
    body = null;
  }
  // Always 200 to Meta; process best-effort.
  if (!body || !Array.isArray(body.entry)) {
    return NextResponse.json({ ok: true });
  }

  const supabase = createAdminClient();

  for (const entry of body.entry) {
    const events: MessagingEvent[] = entry.messaging ?? [];
    for (const ev of events) {
      const text = ev.message?.text;
      const senderId = ev.sender?.id;
      const recipientId = ev.recipient?.id; // the business's IG account id
      // Skip echoes (our own outbound), reactions, and empty events.
      if (!text || !senderId || !recipientId || ev.message?.is_echo) continue;

      // Route to the business that owns this IG account.
      const { data: settings } = await supabase
        .from("ig_settings")
        .select("business_id, page_access_token, auto_reply")
        .eq("ig_account_id", recipientId)
        .maybeSingle();
      if (!settings) continue; // no business connected to this account

      try {
        const result = await handleInboundMessage({
          supabase,
          businessId: settings.business_id,
          igUserId: senderId,
          text,
        });
        if (result.reply && settings.page_access_token) {
          await sendInstagramReply(settings.page_access_token, senderId, result.reply);
        }
      } catch (err) {
        console.error("Instagram inbound handling failed:", err);
      }
    }
  }

  return NextResponse.json({ ok: true });
}
