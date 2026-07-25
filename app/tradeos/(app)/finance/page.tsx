import Link from "next/link";
import { ScanLine, Euro, TrendingDown, AlertTriangle, CheckCircle2 } from "lucide-react";
import { requireTradesAccount } from "@/lib/trades/data";
import { StatCard } from "@/components/portal/stat-card";
import { ActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/admin/submit-button";
import { formatEuro } from "@/lib/trades/core";
import { FinanceAudit } from "@/components/trades/finance-audit";
import { setExpenseStatus } from "@/app/tradeos/actions";

export const metadata = { title: "Finance · TradeOS" };

// The audit runs one AI call inside this route's actions.
export const maxDuration = 60;

type ExpenseRow = {
  id: string;
  direction: string;
  counterparty: string;
  category: string | null;
  doc_number: string | null;
  due_at: string | null;
  total: number;
  status: string;
  summary: string | null;
};

export default async function FinancePage() {
  const { supabase } = await requireTradesAccount();
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: expensesRaw }, { data: invoices }] = await Promise.all([
    supabase
      .from("trades_expenses")
      .select("id, direction, counterparty, category, doc_number, due_at, total, status, summary")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("trades_documents")
      .select("status, total")
      .eq("kind", "invoice")
      .limit(500),
  ]);
  const expenses = (expensesRaw ?? []) as ExpenseRow[];
  const bills = expenses.filter((e) => e.direction === "payable");

  const billsUnpaid = bills.filter((e) => e.status === "unpaid");
  const owedOut = billsUnpaid.reduce((s, e) => s + Number(e.total), 0);
  const spentPaid = bills.filter((e) => e.status === "paid").reduce((s, e) => s + Number(e.total), 0);
  const overdueBills = billsUnpaid.filter((e) => e.due_at && e.due_at < today);
  const owedIn = (invoices ?? [])
    .filter((i) => i.status !== "paid" && i.status !== "void")
    .reduce((s, i) => s + Number(i.total), 0);

  // Spend by supplier — the renegotiation shortlist.
  const bySupplier = new Map<string, number>();
  for (const e of bills) {
    bySupplier.set(e.counterparty, (bySupplier.get(e.counterparty) ?? 0) + Number(e.total));
  }
  const topSuppliers = [...bySupplier.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Finance</h1>
          <p>
            Money in, money out, and where to save — built from your scanned
            bills and TradeOS invoices.
          </p>
        </div>
        <Link href="/tradeos/scan" className="btn btn-primary">
          <ScanLine size={15} /> Scan an invoice
        </Link>
      </div>

      <div className="stat-grid" style={{ marginBottom: 20 }}>
        <StatCard label="Owed to you" value={formatEuro(owedIn)} icon={<Euro />} accent="var(--green, #34d399)" hint="unpaid invoices out" />
        <StatCard label="Bills to pay" value={formatEuro(owedOut)} icon={<TrendingDown />} accent="var(--orange, #fb923c)" hint={`${billsUnpaid.length} unpaid`} />
        <StatCard label="Overdue bills" value={String(overdueBills.length)} icon={<AlertTriangle />} accent={overdueBills.length > 0 ? "var(--red, #f87171)" : undefined} />
        <StatCard label="Paid out (tracked)" value={formatEuro(spentPaid)} icon={<CheckCircle2 />} />
      </div>

      {bills.length === 0 ? (
        <section className="panel panel-block" style={{ marginBottom: 20 }}>
          <p className="empty-state" style={{ margin: 0 }}>
            Nothing tracked yet — <Link href="/tradeos/scan">scan your first supplier invoice</Link>{" "}
            and it lands here with the totals, due date and a ready-drafted email.
          </p>
        </section>
      ) : (
        <div className="grid-main-side" style={{ marginBottom: 20 }}>
          <section className="panel panel-block" aria-labelledby="fin-bills">
            <h2 className="panel-title" id="fin-bills">Bills ({bills.length})</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Supplier</th>
                    <th>Category</th>
                    <th>Due</th>
                    <th style={{ textAlign: "right" }}>Total</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {bills.slice(0, 25).map((e) => {
                    const overdue = e.status === "unpaid" && e.due_at && e.due_at < today;
                    return (
                      <tr key={e.id}>
                        <td>
                          <strong>{e.counterparty}</strong>
                          <div style={{ color: "var(--faint)", fontSize: 12 }}>
                            {[e.doc_number, e.summary].filter(Boolean).join(" · ") || "—"}
                          </div>
                        </td>
                        <td style={{ fontSize: 13 }}>{e.category ?? "—"}</td>
                        <td style={{ fontSize: 13 }}>
                          {e.due_at ?? "—"}
                          {overdue && <span className="badge badge-red" style={{ marginLeft: 6 }}>overdue</span>}
                        </td>
                        <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                          {formatEuro(Number(e.total))}
                        </td>
                        <td>
                          <span className={`badge ${e.status === "paid" ? "badge-green" : e.status === "disputed" ? "badge-orange" : "badge-gray"}`}>
                            {e.status}
                          </span>
                        </td>
                        <td>
                          {e.status !== "paid" && (
                            <ActionForm action={setExpenseStatus} className="inline-form">
                              <input type="hidden" name="id" value={e.id} />
                              <input type="hidden" name="status" value="paid" />
                              <SubmitButton className="btn btn-ghost btn-sm" pendingText="…">
                                Mark paid
                              </SubmitButton>
                            </ActionForm>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel panel-block" aria-labelledby="fin-suppliers">
            <h2 className="panel-title" id="fin-suppliers">Spend by supplier</h2>
            <p style={{ fontSize: 12.5, color: "var(--faint)", marginTop: 0 }}>
              Your renegotiation shortlist — biggest first.
            </p>
            <div style={{ display: "grid", gap: 6, fontSize: 13.5 }}>
              {topSuppliers.map(([name, total]) => (
                <div key={name} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
                  <span style={{ fontVariantNumeric: "tabular-nums", color: "var(--orange, #fb923c)" }}>
                    {formatEuro(total)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      <FinanceAudit />
    </>
  );
}
