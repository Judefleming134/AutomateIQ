import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getResendClient, getFromAddress } from "@/lib/email/resend";

const bodySchema = z.object({ decision: z.enum(["accept", "decline"]) });

/**
 * Public quote accept/decline. No session (the customer isn't a user); the
 * unguessable view_token is the authorization. Idempotent-ish: a quote can
 * only move to accepted/declined once, and an already-decided quote is
 * returned as-is.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: quote } = await admin
    .from("qa_quotes")
    .select("id, business_id, customer_name, total, status")
    .eq("view_token", token)
    .maybeSingle();

  if (!quote) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (quote.status === "accepted" || quote.status === "declined") {
    // Already decided — treat as success so a double-click is harmless.
    return NextResponse.json({ ok: true, status: quote.status });
  }

  const newStatus = parsed.data.decision === "accept" ? "accepted" : "declined";
  const { error } = await admin
    .from("qa_quotes")
    .update({ status: newStatus, decided_at: new Date().toISOString() })
    .eq("id", quote.id);

  if (error) {
    return NextResponse.json({ error: "Update failed" }, { status: 502 });
  }

  // Best-effort: notify the business that a decision was made. Never fails
  // the customer's action.
  try {
    const { data: business } = await admin
      .from("businesses")
      .select("name")
      .eq("id", quote.business_id)
      .single();
    const { data: members } = await admin
      .from("profiles")
      .select("id")
      .eq("business_id", quote.business_id)
      .limit(1);
    const ownerId = members?.[0]?.id;
    if (ownerId) {
      const { data: userRes } = await admin.auth.admin.getUserById(ownerId);
      const ownerEmail = userRes.user?.email;
      if (ownerEmail) {
        const resend = getResendClient();
        await resend.emails.send(
          {
            from: getFromAddress(),
            to: ownerEmail,
            subject:
              newStatus === "accepted"
                ? `✓ ${quote.customer_name} accepted your quote${quote.total ? ` (${quote.total})` : ""}`
                : `${quote.customer_name} declined your quote`,
            text:
              newStatus === "accepted"
                ? `${quote.customer_name} just accepted their quote${quote.total ? ` for ${quote.total}` : ""}. Time to get the job booked in.`
                : `${quote.customer_name} declined their quote. You may want to follow up.`,
          },
          { idempotencyKey: `quote-decision-${quote.id}` }
        );
      }
    }
  } catch (err) {
    console.error("Quote decision notification failed:", err);
  }

  return NextResponse.json({ ok: true, status: newStatus });
}
