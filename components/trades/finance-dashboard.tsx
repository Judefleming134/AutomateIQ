import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ScanLine, Euro, TrendingDown, AlertTriangle, CheckCircle2, Link2 } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { StatCard } from "@/components/portal/stat-card";
import { ActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/admin/submit-button";
import { formatEuro } from "@/lib/trades/core";
import { FinanceAudit } from "@/components/trades/finance-audit";
import { setExpenseStatus } from "@/app/tradeos/actions";

/**
 * The finance engine, shared by BOTH surfaces — TradeOS's Finance tab and the
 * standalone AutomateIQ Finance product at /finance. One account system, one
 * data set, two front doors; a change here upgrades both at once (the "we
 * upgrade it as time goes on" contract). `supabase` is the caller's RLS-scoped
 * client, so every read stays inside their own account.
 */

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
  source: string;
};

export async function FinanceDashboard({
  supabase,
  claimed,
  scanHref,
}: {
  supabase: SupabaseClient;
  claimed?: string;
  scanHref: string;
}) {
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: expensesRaw }, { data: invoices }, { data: connRows }] = await Promise.all([
    supabase
      .from("trades_expenses")
      .select("id, direction, counterparty, category, doc_number, due_at, total, status, summary, source")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("trades_documents")
      .select("status, total")
      .eq("kind", "invoice")
      .limit(500),
    // Own connections via the RLS client; peer names resolved below with the
    // admin client (another account's profile isn't readable under RLS).
    supabase.from("trades_connections").select("peer_account_id"),
  ]);

  let peers: string[] = [];
  const peerIds = [...new Set((connRows ?? []).map((c) => c.peer_account_id as string))];
  if (peerIds.length > 0) {
    const admin = createAdminClient();
    const { data: peerAccounts } = await admin
      .from("trades_accounts")
      .select("id, business_name")
      .in("id", peerIds);
    peers = (peerAccounts ?? []).map((p) => (p.business_name as string) || "TradeOS business");
  }
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
      {claimed === "1" && (
        <div
          className="panel panel-block"
          style={{ marginBottom: 16, borderLeft: "3px solid var(--green, #34d399)" }}
        >
          <p style={{ margin: 0, fontSize: 14 }}>
            <strong>Added to your Finance</strong> — and the two businesses are
            now linked: future invoices between you land in each other&apos;s
            books automatically.
          </p>
        </div>
      )}

      <div className="stat-grid" style={{ marginBottom: 20 }}>
        <StatCard label="Owed to you" value={formatEuro(owedIn)} icon={<Euro />} accent="var(--green, #34d399)" hint="unpaid invoices out" />
        <StatCard label="Bills to pay" value={formatEuro(owedOut)} icon={<TrendingDown />} accent="var(--orange, #fb923c)" hint={`${billsUnpaid.length} unpaid`} />
        <StatCard label="Overdue bills" value={String(overdueBills.length)} icon={<AlertTriangle />} accent={overdueBills.length > 0 ? "var(--red, #f87171)" : undefined} />
        <StatCard label="Paid out (tracked)" value={formatEuro(spentPaid)} icon={<CheckCircle2 />} />
      </div>

      {bills.length === 0 ? (
        <section className="panel panel-block" style={{ marginBottom: 20 }}>
          <p className="empty-state" style={{ margin: 0 }}>
            Nothing tracked yet — <Link href={scanHref}>scan your first supplier invoice</Link>{" "}
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
                          {e.source === "network" && (
                            <span className="badge badge-blue" style={{ marginLeft: 6 }}>
                              TradeOS
                            </span>
                          )}
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

          <div>
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

            <section className="panel panel-block" style={{ marginTop: 16 }} aria-labelledby="fin-network">
              <h2 className="panel-title" id="fin-network">
                <Link2 size={15} style={{ verticalAlign: "-2px" }} /> TradeOS network ({peers.length})
              </h2>
              {peers.length === 0 ? (
                <p style={{ fontSize: 13, color: "var(--faint)", margin: 0 }}>
                  When another TradeOS business invoices you (or you invoice
                  them), claim it and you&apos;re linked — invoices then flow
                  straight into each other&apos;s books, and paid on their side
                  shows paid in yours.
                </p>
              ) : (
                <>
                  <div style={{ display: "grid", gap: 6, fontSize: 13.5 }}>
                    {peers.map((name) => (
                      <div key={name} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span className="badge badge-blue">linked</span>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
                      </div>
                    ))}
                  </div>
                  <p style={{ fontSize: 12, color: "var(--faint)", margin: "10px 0 0" }}>
                    Invoices between linked businesses land in each other&apos;s
                    Finance automatically — and paid on one side shows paid on
                    both.
                  </p>
                </>
              )}
            </section>
          </div>
        </div>
      )}

      <FinanceAudit />

      {/* Product areas — every tool one tap away, and what's landing next
          shown honestly as not-available-yet rather than hidden. */}
      <div className="grid-2" style={{ marginTop: 20 }}>
        <section className="panel panel-block">
          <h2 className="panel-title">Finance tools</h2>
          <div style={{ display: "grid", gap: 8, fontSize: 14 }}>
            <Link href="/finance/forecast">13-week cash-flow forecast →</Link>
            <Link href="/finance/receivables">Who owes you (aging + chase) →</Link>
            <Link href="/finance/budgets">Budgets by category →</Link>
            <Link href="/finance/reports">Monthly report &amp; VAT position →</Link>
            <Link href="/finance/bank">Bank &amp; feeds →</Link>
          </div>
        </section>
        <section className="panel panel-block" style={{ opacity: 0.85 }}>
          <h2 className="panel-title">Coming next</h2>
          <div style={{ display: "grid", gap: 8, fontSize: 13, color: "var(--faint)" }}>
            <span>Live bank connection &amp; auto-reconciliation <span className="badge badge-gray">not available yet</span></span>
            <span>Approvals &amp; team roles <span className="badge badge-gray">not available yet</span></span>
            <span>SEPA payment runs <span className="badge badge-gray">not available yet</span></span>
            <span>Network price benchmarking <span className="badge badge-gray">not available yet</span></span>
          </div>
        </section>
      </div>
    </>
  );
}

/** Scan-an-invoice CTA used in both surfaces' page headers. */
export function ScanCta({ href }: { href: string }) {
  return (
    <Link href={href} className="btn btn-primary">
      <ScanLine size={15} /> Scan an invoice
    </Link>
  );
}
