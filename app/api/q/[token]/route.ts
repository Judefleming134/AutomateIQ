import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncQuoteDecisionToCrm } from "@/lib/quote-agent/quote-to-crm";
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
    .select("id, business_id, customer_name, customer_email, job_description, total, status")
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
  // Atomic decide: only flip a quote that is still undecided, so two concurrent
  // requests (or an accept then a fast decline) can never both apply — the DB
  // arbitrates. If no row comes back, another request decided first; report
  // that decision rather than overwriting it.
  const { data: updated, error } = await admin
    .from("qa_quotes")
    .update({ status: newStatus, decided_at: new Date().toISOString() })
    .eq("id", quote.id)
    .in("status", ["draft", "sent", "viewed"])
    .select("status")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Update failed" }, { status: 502 });
  }
  if (!updated) {
    // Lost the race — re-read the decision that won and return it as success.
    const { data: current } = await admin
      .from("qa_quotes")
      .select("status")
      .eq("id", quote.id)
      .maybeSingle();
    return NextResponse.json({ ok: true, status: current?.status ?? newStatus });
  }

  // The decision is recorded — now make it mean something elsewhere.
  //
  // Accepting a quote is the highest-value event in the platform, and until
  // now it produced no record beyond the quote row: ClientIQ, sold as "every
  // customer and lead in one place", did not know about the customer who had
  // just agreed to pay. This creates or updates that contact, moves them to
  // won (or lost), records the value and writes it into their timeline.
  //
  // Strictly best-effort and deliberately un-awaited-for-failure: the customer
  // has already decided and the quote is already updated, so nothing here may
  // fail their action or delay the response they are waiting on.
  const crmSync = await syncQuoteDecisionToCrm(admin, quote, newStatus);
  if (!crmSync.ok) {
    console.error(`[quote-accept] CRM sync failed for quote ${quote.id}: ${crmSync.reason}`);
  }

  // Best-effort: notify the business that a decision was made. Never fails
  // the customer's action.
  try {
    const { data: business } = await admin
      .from("businesses")
      .select("name")
      .eq("id", quote.business_id)
      .single();
    // Oldest profile = the founding account for that business. An unordered
    // limit(1) let Postgres return ANY member, so on a business with staff the
    // "your quote was accepted" email went to whoever happened to come back
    // first — and could land on a different person each time, with the owner
    // never told a job had just been won.
    const { data: members } = await admin
      .from("profiles")
      .select("id")
      .eq("business_id", quote.business_id)
      .order("created_at", { ascending: true })
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
