import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getResendClient, getFromAddress } from "@/lib/email/resend";
import { isMissingTableError } from "@/lib/db/errors";
import { formatCents, outstandingCents } from "@/lib/quote-agent/invoice";
import {
  shouldChase,
  chaseMessage,
  overdueDays,
  FIRST_CHASE_AFTER_DAYS,
  MAX_CHASES,
} from "@/lib/quote-agent/chase-rules";

/**
 * The automatic chasing /products/tradeiq has been promising.
 *
 * Runs on the existing 07:00 dispatch. Finds invoices that are SENT, past due,
 * still owed and not chased recently, and sends one escalating reminder each.
 *
 * SAFETY, because this emails real customers about money without a human in
 * the loop:
 *   - Only status 'sent'. A draft was never delivered; a paid or void invoice
 *     is not a debt.
 *   - Nothing is chased until FIRST_CHASE_AFTER_DAYS past the due date, and
 *     the sequence STOPS after MAX_CHASES. Endless nagging costs more than
 *     the invoice.
 *   - last_chased_at is written only AFTER the email actually sends, so a
 *     failure retries tomorrow rather than being silently marked done.
 *   - Hard per-run cap, so one bad day cannot turn into a mailout.
 *   - Every failure is collected and reported; nothing is swallowed.
 */

/** Most reminders one run will ever send, across all businesses. */
const PER_RUN_CAP = 25;

/** How far down the candidate list to look. */
const SCAN_LIMIT = 200;

export async function runInvoiceChaser(): Promise<{
  chased: number;
  skipped: number;
  failed: number;
  detail: string;
}> {
  const flag = (process.env.QUOTEIQ_AUTOCHASE ?? "").toLowerCase();
  if (flag === "0" || flag === "off") {
    return { chased: 0, skipped: 0, failed: 0, detail: "invoice chasing disabled" };
  }

  const admin = createAdminClient();
  const now = new Date();
  const nowISO = now.toISOString();
  const today = nowISO.slice(0, 10);

  const { data: candidates, error } = await admin
    .from("qa_invoices")
    .select(
      "id, business_id, number, customer_name, customer_email, amount_cents, paid_amount_cents, currency, status, due_date, view_token, last_chased_at, chase_count"
    )
    .eq("status", "sent")
    .lt("due_date", today)
    // Never-chased first, then longest-neglected. NULLS FIRST is what makes an
    // invoice nobody has ever chased win over one already nagged twice.
    .order("last_chased_at", { ascending: true, nullsFirst: true })
    .order("due_date", { ascending: true })
    .limit(SCAN_LIMIT);

  if (error) {
    if (isMissingTableError(error)) {
      return {
        chased: 0,
        skipped: 0,
        failed: 0,
        detail: "invoice chasing idle — run migrations 0037 and 0038",
      };
    }
    return { chased: 0, skipped: 0, failed: 1, detail: `chaser query failed: ${error.message}` };
  }

  const rows = candidates ?? [];
  if (rows.length === 0) {
    return { chased: 0, skipped: 0, failed: 0, detail: "no overdue invoices" };
  }

  // Business names, fetched once rather than per invoice.
  const businessIds = [...new Set(rows.map((r) => r.business_id))];
  const { data: businesses } = await admin
    .from("businesses")
    .select("id, name")
    .in("id", businessIds);
  const nameById = new Map((businesses ?? []).map((b) => [b.id, b.name as string]));

  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://automateiq.ie").replace(/\/+$/, "");
  const resend = getResendClient();
  if (!resend) {
    return { chased: 0, skipped: rows.length, failed: 0, detail: "email not configured" };
  }

  let chased = 0;
  let skipped = 0;
  const failures: string[] = [];
  const chasedNames: string[] = [];

  for (const invoice of rows) {
    if (chased >= PER_RUN_CAP) {
      skipped += 1;
      continue;
    }
    const decision = shouldChase(invoice, nowISO);
    if (!decision.chase) {
      skipped += 1;
      continue;
    }

    const currency = invoice.currency ?? "EUR";
    const owed = outstandingCents(invoice);
    const paidSoFar = invoice.paid_amount_cents ?? 0;
    const { subject, text } = chaseMessage({
      chaseNumber: decision.nextCount,
      customerName: invoice.customer_name,
      businessName: nameById.get(invoice.business_id) ?? "us",
      invoiceNumber: invoice.number,
      amountLabel: formatCents(owed, currency),
      daysOverdue: overdueDays(invoice.due_date!, nowISO),
      link: `${site}/i/${invoice.view_token}`,
      partPaid: paidSoFar > 0,
    });

    try {
      const sent = await resend.emails.send(
        {
          from: getFromAddress(),
          to: invoice.customer_email!,
          replyTo: "hello@automateiq.ie",
          subject,
          text,
        },
        // One reminder per invoice per chase number, even if this run were
        // somehow repeated — the customer must never get the same nag twice.
        { idempotencyKey: `chase-${invoice.id}-${decision.nextCount}` }
      );
      if (sent.error) {
        failures.push(`${invoice.number}: ${sent.error.message}`);
        continue;
      }
    } catch (err) {
      failures.push(`${invoice.number}: ${err instanceof Error ? err.message : "send failed"}`);
      continue;
    }

    // Recorded ONLY after the send succeeded. Stamping first would mark an
    // invoice as chased that nobody was ever emailed about, and it would never
    // be picked up again.
    const { error: markError } = await admin
      .from("qa_invoices")
      .update({ last_chased_at: nowISO, chase_count: decision.nextCount })
      .eq("id", invoice.id);
    if (markError) {
      // The email HAS gone. Say so loudly: the next run will otherwise send it
      // again, which is the one outcome worse than not chasing at all.
      failures.push(`${invoice.number}: sent but not recorded (${markError.message})`);
      continue;
    }

    chased += 1;
    chasedNames.push(`${invoice.number} (${formatCents(owed, currency)})`);
  }

  const detail = chased
    ? `chased ${chased}: ${chasedNames.slice(0, 6).join(", ")}${chasedNames.length > 6 ? "…" : ""}${
        failures.length ? ` · ${failures.length} failed` : ""
      }`
    : failures.length
      ? `nothing chased · ${failures.length} failed: ${failures.slice(0, 3).join("; ")}`
      : `nothing due a reminder (${rows.length} overdue, none past the ${FIRST_CHASE_AFTER_DAYS}-day mark or all within the ${MAX_CHASES}-reminder limit)`;

  return { chased, skipped, failed: failures.length, detail };
}
