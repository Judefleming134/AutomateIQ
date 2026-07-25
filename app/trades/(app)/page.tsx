import Link from "next/link";
import { FilePlus2, Euro, Clock, AlertTriangle, CheckCircle2 } from "lucide-react";
import { requireTradesAccount, needsOnboarding } from "@/lib/trades/data";
import { StatCard } from "@/components/portal/stat-card";
import { DOCUMENT_STATUS_META, formatEuro, isOverdue } from "@/lib/trades/core";

export const metadata = { title: "Dashboard · AutomateIQ Trades" };

type DocRow = {
  id: string;
  kind: "quote" | "invoice";
  number: string;
  status: string;
  total: number;
  issued_at: string | null;
  due_at: string | null;
  created_at: string;
  trades_customers: { name: string } | null;
};

export default async function TradesDashboard() {
  const { supabase, account } = await requireTradesAccount();

  const { data: docsRaw } = await supabase
    .from("trades_documents")
    .select("id, kind, number, status, total, issued_at, due_at, created_at, trades_customers(name)")
    .order("created_at", { ascending: false })
    .limit(25);
  const docs = (docsRaw ?? []) as unknown as DocRow[];

  // Money view: what's owed vs collected, plus how many quotes are still live.
  const invoices = docs.filter((d) => d.kind === "invoice");
  const outstanding = invoices
    .filter((d) => d.status !== "paid" && d.status !== "void")
    .reduce((s, d) => s + Number(d.total), 0);
  const paid = invoices
    .filter((d) => d.status === "paid")
    .reduce((s, d) => s + Number(d.total), 0);
  const openQuotes = docs.filter(
    (d) => d.kind === "quote" && (d.status === "sent" || d.status === "draft")
  ).length;
  const overdueCount = docs.filter((d) => isOverdue(d)).length;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p>Your quotes and invoices — create one, send it, get paid.</p>
        </div>
        <Link href="/trades/new" className="btn btn-primary">
          <FilePlus2 size={15} /> New quote
        </Link>
      </div>

      {needsOnboarding(account) && (
        <div
          className="panel panel-block"
          style={{ marginBottom: 16, borderLeft: "3px solid var(--orange, #fb923c)" }}
        >
          <p style={{ margin: 0, fontSize: 14 }}>
            <strong>Finish setup first.</strong> Add your business name, VAT rate
            and payment terms so your quotes and invoices look right and total
            correctly.{" "}
            <Link href="/trades/settings">Go to settings →</Link>
          </p>
        </div>
      )}

      <div className="stat-grid" style={{ marginBottom: 20 }}>
        <StatCard label="Outstanding" value={formatEuro(outstanding)} icon={<Euro />} accent="var(--orange, #fb923c)" hint="unpaid invoices" />
        <StatCard label="Paid" value={formatEuro(paid)} icon={<CheckCircle2 />} accent="var(--green, #34d399)" />
        <StatCard label="Open quotes" value={String(openQuotes)} icon={<Clock />} hint="awaiting a yes" />
        <StatCard label="Overdue" value={String(overdueCount)} icon={<AlertTriangle />} accent={overdueCount > 0 ? "var(--red, #f87171)" : undefined} />
      </div>

      <section className="panel panel-block">
        <h2 className="panel-title">Recent</h2>
        {docs.length === 0 ? (
          <p className="empty-state">
            Nothing yet. <Link href="/trades/new">Create your first quote →</Link>
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Customer</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th style={{ textAlign: "right" }}>Total</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => {
                  const meta = DOCUMENT_STATUS_META[d.status];
                  const overdue = isOverdue(d);
                  return (
                    <tr key={d.id}>
                      <td>
                        <Link href={`/trades/documents/${d.id}`}>
                          <strong>{d.number}</strong>
                        </Link>
                      </td>
                      <td>{d.trades_customers?.name ?? "—"}</td>
                      <td style={{ textTransform: "capitalize" }}>{d.kind}</td>
                      <td>
                        <span className={`badge ${meta?.badge ?? "badge-gray"}`}>
                          {meta?.label ?? d.status}
                        </span>
                        {overdue && (
                          <span className="badge badge-red" style={{ marginLeft: 6 }}>
                            overdue
                          </span>
                        )}
                      </td>
                      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        {formatEuro(Number(d.total))}
                      </td>
                      <td style={{ fontSize: 13, color: "var(--faint)" }}>
                        {(d.issued_at ?? d.created_at).slice(0, 10)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
