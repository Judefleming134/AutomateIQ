/**
 * FinanceIQ — pure analytics over the account's records. No I/O, so
 * every number on the Forecast/Receivables/Budgets/Reports screens is
 * reproducible and unit-testable. Dates are YYYY-MM-DD strings throughout
 * (matching the DB columns); "today" is always passed in, never read from the
 * clock inside, so the maths can be tested frozen in time.
 */

/** Cent-safe rounding (same contract as lib/trades/core.roundMoney; local so
 *  this module stays dependency-free and runnable under plain node tests). */
function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/* ── shared shapes ─────────────────────────────────────────────────── */

export type CashItem = {
  /** Positive euro amount. */
  amount: number;
  /** When the money is expected to move (falls back to issued date upstream). */
  due: string | null;
  label: string;
  /** True for model-predicted items (recurring bills), false for real records. */
  predicted?: boolean;
};

export type ForecastWeek = {
  weekStart: string; // Monday, YYYY-MM-DD
  inflow: number;
  outflow: number;
  net: number;
  balance: number; // running, from the starting bank balance
  predictedOutflow: number; // portion of outflow that is model-predicted
};

const DAY = 86_400_000;

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Monday of the week containing `iso` (ISO weeks — Mon..Sun). */
export function weekStartOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0
  return addDays(iso, -dow);
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
}

/* ── 13-week cash-flow forecast ────────────────────────────────────── */

/**
 * The enterprise-standard 13-week rolling forecast. Inputs are the four the
 * industry uses: starting balance, expected AR inflows, expected AP outflows,
 * and predicted recurring bills. Anything already overdue is treated as
 * landing in week 1 (the honest assumption: it's due NOW), and items with no
 * due date land in week 1 too rather than silently vanishing.
 */
export function buildForecast(params: {
  today: string;
  startingBalance: number;
  inflows: CashItem[];
  outflows: CashItem[];
  weeks?: number;
}): ForecastWeek[] {
  const weeks = params.weeks ?? 13;
  const firstWeek = weekStartOf(params.today);
  const rows: ForecastWeek[] = Array.from({ length: weeks }, (_, i) => ({
    weekStart: addDays(firstWeek, i * 7),
    inflow: 0,
    outflow: 0,
    net: 0,
    balance: 0,
    predictedOutflow: 0,
  }));

  const bucketIndex = (due: string | null): number => {
    if (!due || due < params.today) return 0; // overdue/undated → now
    const idx = Math.floor(daysBetween(firstWeek, weekStartOf(due)) / 7);
    return idx >= weeks ? -1 : Math.max(0, idx); // beyond horizon → dropped
  };

  for (const item of params.inflows) {
    const i = bucketIndex(item.due);
    if (i >= 0) rows[i].inflow = roundMoney(rows[i].inflow + item.amount);
  }
  for (const item of params.outflows) {
    const i = bucketIndex(item.due);
    if (i >= 0) {
      rows[i].outflow = roundMoney(rows[i].outflow + item.amount);
      if (item.predicted) {
        rows[i].predictedOutflow = roundMoney(rows[i].predictedOutflow + item.amount);
      }
    }
  }

  let balance = params.startingBalance;
  for (const r of rows) {
    r.net = roundMoney(r.inflow - r.outflow);
    balance = roundMoney(balance + r.net);
    r.balance = balance;
  }
  return rows;
}

/* ── recurring-bill detection ──────────────────────────────────────── */

export type RecurringBill = {
  counterparty: string;
  avgAmount: number;
  intervalDays: number;
  lastSeen: string;
  nextExpected: string;
};

/**
 * A supplier who has billed ≥2 times at a steady cadence (20–45 day gaps,
 * i.e. roughly monthly) with broadly similar amounts is treated as recurring.
 * Deliberately conservative: better to miss a pattern than invent one.
 */
export function detectRecurring(
  bills: { counterparty: string; total: number; issued: string | null }[],
  today: string
): RecurringBill[] {
  const bySupplier = new Map<string, { total: number; issued: string }[]>();
  for (const b of bills) {
    if (!b.issued || !b.counterparty) continue;
    const list = bySupplier.get(b.counterparty) ?? [];
    list.push({ total: Number(b.total), issued: b.issued });
    bySupplier.set(b.counterparty, list);
  }

  const out: RecurringBill[] = [];
  for (const [counterparty, list] of bySupplier) {
    if (list.length < 2) continue;
    list.sort((a, b) => (a.issued < b.issued ? -1 : 1));
    const gaps: number[] = [];
    for (let i = 1; i < list.length; i++) {
      gaps.push(daysBetween(list[i - 1].issued, list[i].issued));
    }
    if (!gaps.every((g) => g >= 20 && g <= 45)) continue;
    const avgGap = Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length);
    const avg = roundMoney(list.reduce((s, x) => s + x.total, 0) / list.length);
    // Amount stability: every bill within ±25% of the average.
    if (!list.every((x) => Math.abs(x.total - avg) <= avg * 0.25)) continue;
    const lastSeen = list[list.length - 1].issued;
    let nextExpected = addDays(lastSeen, avgGap);
    // If the predicted date already passed, roll forward to the next cycle.
    while (nextExpected < today) nextExpected = addDays(nextExpected, avgGap);
    out.push({ counterparty, avgAmount: avg, intervalDays: avgGap, lastSeen, nextExpected });
  }
  return out.sort((a, b) => (a.nextExpected < b.nextExpected ? -1 : 1));
}

/** Predicted occurrences of the recurring bills inside the forecast horizon. */
export function recurringToOutflows(
  recurring: RecurringBill[],
  today: string,
  horizonDays = 13 * 7
): CashItem[] {
  const end = addDays(today, horizonDays);
  const out: CashItem[] = [];
  for (const r of recurring) {
    let d = r.nextExpected;
    while (d <= end) {
      out.push({ amount: r.avgAmount, due: d, label: `${r.counterparty} (expected)`, predicted: true });
      d = addDays(d, r.intervalDays);
    }
  }
  return out;
}

/* ── receivables aging + chase ladder ──────────────────────────────── */

export const AGING_BUCKETS = ["Current", "1–30 days", "31–60 days", "61–90 days", "90+ days"] as const;

export function agingBucket(due: string | null, today: string): (typeof AGING_BUCKETS)[number] {
  if (!due || due >= today) return "Current";
  const days = daysBetween(due, today);
  if (days <= 30) return "1–30 days";
  if (days <= 60) return "31–60 days";
  if (days <= 90) return "61–90 days";
  return "90+ days";
}

export function daysOverdue(due: string | null, today: string): number {
  if (!due || due >= today) return 0;
  return daysBetween(due, today);
}

/**
 * The dunning ladder every AR platform runs: friendly nudge first, firmer at
 * a month, final notice at two — with the recommended tone for the drafted
 * chase email at each stage.
 */
export function chaseStage(overdueDays: number): {
  stage: "not_due" | "gentle" | "firm" | "final";
  label: string;
} {
  if (overdueDays <= 0) return { stage: "not_due", label: "Not due yet" };
  if (overdueDays <= 14) return { stage: "gentle", label: "Send a friendly reminder" };
  if (overdueDays <= 45) return { stage: "firm", label: "Send a firm chase" };
  return { stage: "final", label: "Send a final notice" };
}

/* ── Irish VAT periods (bi-monthly, Jan/Feb = period 1) ────────────── */

export type VatPeriod = { label: string; start: string; end: string };

/** The `count` most recent bi-monthly VAT periods, current period first. */
export function vatPeriods(today: string, count = 3): VatPeriod[] {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7)); // 1-12
  const periodIndex = Math.floor((m - 1) / 2); // 0..5 within the year
  const out: VatPeriod[] = [];
  for (let k = 0; k < count; k++) {
    let idx = periodIndex - k;
    let year = y;
    while (idx < 0) {
      idx += 6;
      year -= 1;
    }
    const startMonth = idx * 2 + 1;
    const endMonth = startMonth + 1;
    const start = `${year}-${String(startMonth).padStart(2, "0")}-01`;
    const endDay = new Date(Date.UTC(year, endMonth, 0)).getUTCDate();
    const end = `${year}-${String(endMonth).padStart(2, "0")}-${String(endDay).padStart(2, "0")}`;
    const mn = (n: number) =>
      ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][n - 1];
    out.push({ label: `${mn(startMonth)}–${mn(endMonth)} ${year}`, start, end });
  }
  return out;
}

/** Last `count` calendar months as {label, start, end}, current month first. */
export function recentMonths(today: string, count = 6): VatPeriod[] {
  const out: VatPeriod[] = [];
  let y = Number(today.slice(0, 4));
  let m = Number(today.slice(5, 7));
  for (let k = 0; k < count; k++) {
    const start = `${y}-${String(m).padStart(2, "0")}-01`;
    const endDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const end = `${y}-${String(m).padStart(2, "0")}-${String(endDay).padStart(2, "0")}`;
    const mn = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1];
    out.push({ label: `${mn} ${y}`, start, end });
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}
