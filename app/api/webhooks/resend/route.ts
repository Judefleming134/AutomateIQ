import { NextResponse, type NextRequest } from "next/server";
import crypto from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Resend delivery webhooks → the Growth Engine's ground truth.
 * Closes the loop Jude asked for: the platform now KNOWS what delivered,
 * bounced or stalled instead of assuming every send arrived.
 *
 *   bounced    → message marked failed, dead address removed from the
 *                prospect (autopilot can never fire at it again), note
 *                stamped on the record
 *   complained → marked in the record, address removed (never email again)
 *   delayed    → informational activity (usually resolves itself)
 *   delivered  → confirmation activity on the prospect's timeline
 *
 * Every event logs an "Email delivery:" activity; the morning brief
 * surfaces the problem ones, and bounce notes reach Jarvis via the
 * prospect's notes.
 *
 * Setup: Resend dashboard → Webhooks → https://automateiq.ie/api/webhooks/resend
 * (events: bounced, complained, delivery_delayed, delivered), signing
 * secret in RESEND_WEBHOOK_SECRET. Svix-style signature verified with
 * node crypto — unsigned or mis-signed requests are rejected, and the
 * endpoint is disabled entirely until the secret is configured.
 */

function verifySignature(req: NextRequest, rawBody: string): boolean {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return false;
  const id = req.headers.get("svix-id");
  const timestamp = req.headers.get("svix-timestamp");
  const signatures = req.headers.get("svix-signature");
  if (!id || !timestamp || !signatures) return false;
  // Reject stale timestamps (replay window: 5 minutes).
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = crypto
    .createHmac("sha256", secretBytes)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest("base64");
  return signatures.split(" ").some((part) => {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) return false;
    try {
      return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    } catch {
      return false;
    }
  });
}

type ResendEvent = {
  type?: string;
  data?: {
    to?: string[];
    subject?: string;
    bounce?: { message?: string };
  };
};

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  if (!verifySignature(request, rawBody)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let event: ResendEvent;
  try {
    event = JSON.parse(rawBody) as ResendEvent;
  } catch {
    return NextResponse.json({ error: "bad payload" }, { status: 400 });
  }

  const type = event.type ?? "";
  const to = (event.data?.to ?? [])[0]?.toLowerCase().trim();
  if (!type.startsWith("email.") || !to) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const admin = createAdminClient();
  const { data: prospect } = await admin
    .from("ge_prospects")
    .select("id, company, email, notes")
    .ilike("email", to)
    .limit(1)
    .maybeSingle();
  // Not a growth-engine recipient (booking emails etc.) — acknowledge and move on.
  if (!prospect) return NextResponse.json({ ok: true, skipped: true });

  const today = new Date().toISOString().slice(0, 10);
  const log = (content: string) =>
    admin.from("ge_activities").insert({
      prospect_id: prospect.id,
      type: "system",
      content,
      created_by: null,
    });

  if (type === "email.bounced" || type === "email.complained") {
    const why =
      type === "email.bounced"
        ? `BOUNCED (${event.data?.bounce?.message?.slice(0, 120) ?? "invalid address"})`
        : "SPAM COMPLAINT — never email this address again";
    // The latest sent email to this prospect is the one that failed.
    const { data: msg } = await admin
      .from("ge_messages")
      .select("id")
      .eq("prospect_id", prospect.id)
      .eq("channel", "email")
      .eq("direction", "outbound")
      .eq("status", "sent")
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (msg) {
      await admin.from("ge_messages").update({ status: "failed" }).eq("id", msg.id);
    }
    // Remove the dead address so nothing can send to it again; keep the
    // evidence in notes (which Jarvis reads).
    const note = `⚠ ${today}: email ${to} ${type === "email.bounced" ? "bounced — invalid address, removed" : "marked us as spam — removed, do not email"}`;
    await admin
      .from("ge_prospects")
      .update({
        email: null,
        notes: prospect.notes ? `${prospect.notes}\n${note}` : note,
      })
      .eq("id", prospect.id);
    await log(`Email delivery: ${why} — address ${to} removed from the record`);
  } else if (type === "email.delivery_delayed") {
    await log(
      `Email delivery: delayed to ${to} — their mail server is slow, usually resolves on its own`
    );
  } else if (type === "email.delivered") {
    await log(`Email delivery: delivered to ${to}`);
  }

  return NextResponse.json({ ok: true });
}
