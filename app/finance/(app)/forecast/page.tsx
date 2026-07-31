import Link from "next/link";
import { CalendarRange, Repeat } from "lucide-react";
import { requireTradesAccount } from "@/lib/trades/data";
import { formatEuro } from "@/lib/trades/core";
import {
  buildForecast,
  detectRecurring,
  recurringToOutflows,
  type CashItem,
} from "@/lib/finance/insights";
import { BankBalanceForm } from "@/components/trades/bank-balance-form";

export const metadata = { title: "Cash-flow forecast · FinanceIQ" };

export default async function ForecastPage() {
  const { supabase, account } = await requireTradesAccount("/finance/login");
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: invoices }, { data: expenses }] = await Promise.all([
    supabase
      .from("trades_documents")
      .select("number, status, total, due_at")
      .eq("kind", "invoice")
      // Sent/accepted only — same rule as the Receivables page. A draft
      // invoice hasn't reached the customer, so counting it as money-in
      // painted an optimistic forecast that Receivables didn't back up.
      .in("status", ["sent", "accepted"])
      .limit(500),
    supabase
      .from("trades_expenses")
      .select("direction, counterparty, total, status, due_at, issued_at")
      .limit(500),
  ]);

  // Money in: unpaid invoices + unpaid receivable records.
  const inflows: CashItem[] = [
    ...(invoices ?? []).map((i) => ({
      amount: Number(i.total),
      due: i.due_at,
      label: `Invoice ${i.number}`,
    })),
    ...(expenses ?? [])
      .filter((e) => e.direction === "receivable" && e.status === "unpaid")
      .map((e) => ({ amount: Number(e.total), due: e.due_at, label: e.counterparty })),
  ];
  // Money out: unpaid bills + predicted recurring bills.
  const unpaidBills: CashItem[] = (expenses ?? [])
    .filter((e) => e.direction === "payable" && e.status === "unpaid")
    .map((e) => ({ amount: Number(e.total), due: e.due_at, label: e.counterparty }));
  const recurring = detectRecurring(
    (expenses ?? [])
      .filter((e) => e.direction === "payable")
      .map((e) => ({ counterparty: e.counterparty, total: Number(e.total), issued: e.issued_at })),
    today
  );
  const predicted = recurringToOutflows(recurring, today);

  const startingBalance = account.bank_balance != null ? Number(account.bank_balance) : 0;
  const weeks = buildForecast({
    today,
    startingBalance,
    inflows,
    outflows: [...unpaidBills, ...predicted],
  });
  const lowest = weeks.reduce((min, w) => (w.balance < min.balance ? w : min), weeks[0]);
  const maxAbs = Math.max(1, ...weeks.map((w) => Math.max(w.inflow, w.outflow)));

  return (
    <>
      <div className="page-header">
        <div>
          <h1>
            <CalendarRange size={20} style={{ verticalAlign: "-3px", marginRight: 8 }} />
            13-week cash-flow forecast
          </h1>
          <p>
            Built from your unpaid invoices, unpaid bills and predicted
            recurring bills — the same rolling forecast enterprise treasury
            teams run.
          </p>
        </div>
      </div>

      {account.bank_balance == null && (
        <div className="panel panel-block" style={{ marginBottom: 16, borderLeft: "3px solid var(--orange, #fb923c)" }}>
          <p style={{ margin: 0, fontSize: 14 }}>
            <strong>Set your current bank balance below</strong> so the running
            balance line means something — right now it starts from €0.
          </p>
        </div>
      )}

      {lowest.balance < 0 && (
        <div className="panel panel-block" style={{ marginBottom: 16, borderLeft: "3px solid var(--red, #f87171)" }}>
          <p style={{ margin: 0, fontSize: 14 }}>
            <strong>Cash dips below zero</strong> in the week of {lowest.weekStart} ({formatEuro(lowest.balance)}).
            Chase what&apos;s owed on the <Link href="/finance/receivables">Receivables</Link> list, or push a bill&apos;s
            due date out.
          </p>
        </div>
      )}

      <section className="panel panel-block" style={{ marginBottom: 16 }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Week of</th>
                <th style={{ textAlign: "right" }}>Money in</th>
                <th style={{ textAlign: "right" }}>Money out</th>
                <th style={{ textAlign: "right" }}>Net</th>
                <th style={{ textAlign: "right" }}>Balance</th>
                <th style={{ minWidth: 140 }}></th>
              </tr>
            </thead>
            <tbody>
              {weeks.map((w, i) => (
                <tr key={w.weekStart}>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {w.weekStart}
                    {i === 0 && <span className="badge badge-blue" style={{ marginLeft: 6 }}>this week</span>}
                  </td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: w.inflow > 0 ? "var(--green, #34d399)" : "var(--faint)" }}>
                    {w.inflow > 0 ? formatEuro(w.inflow) : "—"}
                  </td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: w.outflow > 0 ? "var(--orange, #fb923c)" : "var(--faint)" }}>
                    {w.outflow > 0 ? formatEuro(w.outflow) : "—"}
                    {w.predictedOutflow > 0 && (
                      <span style={{ fontSize: 11, color: "var(--faint)" }}> ({formatEuro(w.predictedOutflow)} predicted)</span>
                    )}
                  </td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatEuro(w.net)}</td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: w.balance < 0 ? "var(--red, #f87171)" : undefined }}>
                    {formatEuro(w.balance)}
                  </td>
                  <td>
                    {/* in/out mini-bars so the shape of the quarter reads at a glance */}
                    <div style={{ display: "grid", gap: 2 }}>
                      <div style={{ height: 5, width: `${Math.round((w.inflow / maxAbs) * 100)}%`, minWidth: w.inflow > 0 ? 3 : 0, background: "var(--green, #34d399)", borderRadius: 3 }} />
                      <div style={{ height: 5, width: `${Math.round((w.outflow / maxAbs) * 100)}%`, minWidth: w.outflow > 0 ? 3 : 0, background: "var(--orange, #fb923c)", borderRadius: 3 }} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ fontSize: 12, color: "var(--faint)", margin: "10px 0 0" }}>
          Overdue and undated items count in week 1 — they&apos;re due now.
          Draft invoices don&apos;t count until they&apos;re sent. Predicted
          amounts come from your recurring bills below.{" "}
          <span className="badge badge-gray">What-if scenarios — not available yet</span>
        </p>
      </section>

      <div className="grid-2" style={{ marginBottom: 16 }}>
        <BankBalanceForm
          balance={account.bank_balance != null ? Number(account.bank_balance) : null}
          setAt={account.bank_balance_set_at ?? null}
        />
        <section className="panel panel-block">
          <h2 className="panel-title">
            <Repeat size={16} style={{ verticalAlign: "-3px" }} /> Recurring bills detected
          </h2>
          {recurring.length === 0 ? (
            <p className="empty-state" style={{ margin: 0 }}>
              Nothing steady yet — once the same supplier shows up a couple of
              months running, it&apos;s predicted here and fed into the forecast
              automatically.
            </p>
          ) : (
            <div style={{ display: "grid", gap: 8, fontSize: 13.5 }}>
              {recurring.map((r) => (
                <div key={r.counterparty} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <span>
                    <strong>{r.counterparty}</strong>{" "}
                    <span style={{ color: "var(--faint)", fontSize: 12 }}>every ~{r.intervalDays}d</span>
                  </span>
                  <span style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                    ~{formatEuro(r.avgAmount)} · next {r.nextExpected}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
