import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingTableError } from "@/lib/db/errors";
import {
  formatCents,
  outstandingCents,
  displayStatus,
  type InvoiceStatus,
} from "@/lib/quote-agent/invoice";

/**
 * The money section of the morning brief.
 *
 * The brief has always told Jude about leads, replies and overnight fixes —
 * and nothing whatsoever about money. He reads it at 07:00 every day, and it
 * could not tell him a customer had paid, that €4,000 was sitting unpaid, or
 * that the oldest invoice was six weeks late.
 *
 * Worse since #518: the invoice chaser now emails real customers about overdue
 * money every morning, and the brief said nothing about that either. An
 * automated thing that contacts customers and is invisible to the person
 * responsible for those customers is exactly the kind of quiet machinery that
 * costs a relationship before anyone notices.
 *
 * Pure formatter + a tolerant fetch, so the numbers are testable without a
 * database and the block simply doesn't appear until 0037/0038 are run.
 */

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
type Client = SupabaseClient<any, any, any>;

export type MoneyInvoice = {
  number: string;
  customer_name: string;
  amount_cents: number;
  paid_amount_cents: number | null;
  currency: string | null;
  /** The DB column is text; the four values the check constraint allows. */
  status: InvoiceStatus | string;
  due_date: string | null;
  paid_at: string | null;
  chase_count: number | null;
};

export type MoneySummary = {
  /** Everything sent and not settled. */
  outstandingCents: number;
  outstandingCount: number;
  /** The subset that is past its due date. */
  overdueCents: number;
  overdueCount: number;
  /** Longest-overdue invoice, for the one line that actually prompts action. */
  worst: { number: string; customer: string; days: number; cents: number } | null;
  /** Settled in the last 24 hours — the good news, which deserves to lead. */
  paidCents: number;
  paidCount: number;
  /** Invoices that have exhausted the chase sequence and need a human. */
  needsCall: { number: string; customer: string; cents: number }[];
  currency: string;
};

/** Whole days between a date and now, floored, never negative. */
function daysLate(dueDate: string, todayISO: string): number {
  const due = Date.parse(`${dueDate.slice(0, 10)}T00:00:00Z`);
  const now = Date.parse(`${todayISO.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(due) || !Number.isFinite(now)) return 0;
  return Math.max(0, Math.floor((now - due) / 86_400_000));
}

/**
 * Reduces the invoice rows to the handful of numbers worth reading at 07:00.
 *
 * Deliberately NOT a list of every invoice: the brief's whole discipline is
 * that it prompts action rather than dumping data. One total, one overdue
 * figure, the single worst offender, and anything the engine has given up
 * chasing.
 */
export function summariseMoney(
  invoices: MoneyInvoice[],
  todayISO: string
): MoneySummary {
  const since = Date.parse(todayISO) - 24 * 3600 * 1000;
  let outstanding = 0;
  let outstandingCount = 0;
  let overdue = 0;
  let overdueCount = 0;
  let paid = 0;
  let paidCount = 0;
  let worst: MoneySummary["worst"] = null;
  const needsCall: MoneySummary["needsCall"] = [];
  const currency = invoices.find((i) => i.currency)?.currency ?? "EUR";

  for (const inv of invoices) {
    if (inv.status === "paid") {
      // Only count a payment as news if it landed in the window. An invoice
      // paid last month is not this morning's good news.
      if (inv.paid_at && Date.parse(inv.paid_at) >= since) {
        paid += inv.paid_amount_cents ?? inv.amount_cents;
        paidCount += 1;
      }
      continue;
    }
    if (inv.status !== "sent") continue; // drafts aren't owed; void isn't owed

    const owed = outstandingCents({ ...inv, status: "sent" });
    if (owed <= 0) continue;
    outstanding += owed;
    outstandingCount += 1;

    // Narrowed above: only 'sent' reaches here, which is a valid InvoiceStatus.
    const shown = displayStatus({ ...inv, status: "sent" }, todayISO.slice(0, 10));
    if (shown === "overdue" || (inv.due_date && daysLate(inv.due_date, todayISO) > 0)) {
      overdue += owed;
      overdueCount += 1;
      const days = inv.due_date ? daysLate(inv.due_date, todayISO) : 0;
      if (!worst || days > worst.days) {
        worst = { number: inv.number, customer: inv.customer_name, days, cents: owed };
      }
      // The engine has done all three reminders and stopped. This is the line
      // that turns "automatic chasing" into something a human finishes.
      if ((inv.chase_count ?? 0) >= 3) {
        needsCall.push({ number: inv.number, customer: inv.customer_name, cents: owed });
      }
    }
  }

  return {
    outstandingCents: outstanding,
    outstandingCount,
    overdueCents: overdue,
    overdueCount,
    worst,
    paidCents: paid,
    paidCount,
    needsCall,
    currency,
  };
}

/**
 * The block as it appears in the brief. Empty string when there is genuinely
 * nothing to say — a heading over "€0 outstanding" is noise, and noise in a
 * daily email is how the whole thing stops being read.
 */
export function formatMoneyBlock(
  s: MoneySummary,
  chased?: { chased: number; detail: string }
): string {
  const nothingHappening =
    s.outstandingCount === 0 && s.paidCount === 0 && !chased?.chased;
  if (nothingHappening) return "";

  const fmt = (c: number) => formatCents(c, s.currency);
  const lines: string[] = [];

  // Good news leads. Getting paid is the point of the whole system.
  if (s.paidCount > 0) {
    lines.push(
      `• ✅ ${fmt(s.paidCents)} paid in the last 24h (${s.paidCount} invoice${s.paidCount === 1 ? "" : "s"})`
    );
  }
  if (s.outstandingCount > 0) {
    lines.push(
      `• ${fmt(s.outstandingCents)} outstanding across ${s.outstandingCount} invoice${s.outstandingCount === 1 ? "" : "s"}` +
        (s.overdueCount > 0 ? ` — ${fmt(s.overdueCents)} of it overdue` : ", none overdue")
    );
  }
  if (s.worst) {
    lines.push(
      `• Oldest: ${s.worst.number} — ${s.worst.customer}, ${fmt(s.worst.cents)}, ${s.worst.days} day${s.worst.days === 1 ? "" : "s"} late`
    );
  }
  if (chased?.chased) {
    lines.push(`• Chased ${chased.chased} automatically this morning`);
  }
  // The handover. The engine stops at three reminders on purpose; this is the
  // only place that says so, and without it those invoices go quiet forever.
  if (s.needsCall.length > 0) {
    const named = s.needsCall
      .slice(0, 3)
      .map((n) => `${n.customer} (${fmt(n.cents)})`)
      .join(", ");
    lines.push(
      `• 📞 ${s.needsCall.length} past automatic chasing — needs a call: ${named}${s.needsCall.length > 3 ? "…" : ""}`
    );
  }

  return `💶 MONEY\n${lines.join("\n")}`;
}

/**
 * Fetches and summarises. Returns null — so the block vanishes entirely —
 * when invoicing isn't set up yet, rather than reporting zeros as though the
 * business had no money owed to it.
 */
export async function loadMoneySummary(
  admin: Client,
  todayISO: string
): Promise<MoneySummary | null> {
  const { data, error } = await admin
    .from("qa_invoices")
    .select(
      "number, customer_name, amount_cents, paid_amount_cents, currency, status, due_date, paid_at, chase_count"
    )
    .in("status", ["sent", "paid"])
    .order("due_date", { ascending: true })
    .limit(500);
  if (error) {
    // Not set up yet is not the same as nothing owed, and must not be reported
    // as though it were.
    if (isMissingTableError(error)) return null;
    return null;
  }
  return summariseMoney((data ?? []) as MoneyInvoice[], todayISO);
}
