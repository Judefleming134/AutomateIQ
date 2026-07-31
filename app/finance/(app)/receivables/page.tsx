import Link from "next/link";
import { HandCoins } from "lucide-react";
import { requireTradesAccount } from "@/lib/trades/data";
import { formatEuro } from "@/lib/trades/core";
import { AGING_BUCKETS, agingBucket, chaseStage, daysOverdue } from "@/lib/finance/insights";
import { ReceivableChase } from "@/components/trades/receivable-chase";

export const metadata = { title: "Receivables · AutomateIQ Finance" };

// Chase drafts run one AI call inside this route's actions.
export const maxDuration = 60;

type Item = {
  key: string;
  who: string;
  ref: string;
  due: string | null;
  total: number;
  /** Link target for invoices; expense id for chase drafting. */
  invoiceHref?: string;
  expenseId?: string;
};

export default async function ReceivablesPage() {
  const { supabase } = await requireTradesAccount("/finance/login");
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: invoices }, { data: recv }] = await Promise.all([
    supabase
      .from("trades_documents")
      .select("id, number, status, total, due_at, trades_customers(name)")
      .eq("kind", "invoice")
      .in("status", ["sent", "accepted"])
      .limit(300),
    supabase
      .from("trades_expenses")
      .select("id, counterparty, doc_number, total, due_at")
      .eq("direction", "receivable")
      .eq("status", "unpaid")
      .limit(300),
  ]);

  const items: Item[] = [
    ...(invoices ?? []).map((i) => ({
      key: `d-${i.id}`,
      who: (i.trades_customers as unknown as { name: string } | null)?.name ?? "—",
      ref: i.number,
      due: i.due_at,
      total: Number(i.total),
      invoiceHref: `/tradeos/documents/${i.id}`,
    })),
    ...(recv ?? []).map((e) => ({
      key: `e-${e.id}`,
      who: e.counterparty,
      ref: e.doc_number ?? "scanned",
      due: e.due_at,
      total: Number(e.total),
      expenseId: e.id,
    })),
  ].sort((a, b) => daysOverdue(b.due, today) - daysOverdue(a.due, today));

  const totalOwed = items.reduce((s, i) => s + i.total, 0);
  const buckets = AGING_BUCKETS.map((label) => ({
    label,
    total: items.filter((i) => agingBucket(i.due, today) === label).reduce((s, i) => s + i.total, 0),
    count: items.filter((i) => agingBucket(i.due, today) === label).length,
  }));

  return (
    <>
      <div className="page-header">
        <div>
          <h1>
            <HandCoins size={20} style={{ verticalAlign: "-3px", marginRight: 8 }} />
            Who owes you
          </h1>
          <p>
            {formatEuro(totalOwed)} outstanding across {items.length} item
            {items.length === 1 ? "" : "s"} — most overdue first, with the right
            chase one tap away.
          </p>
        </div>
      </div>

      {/* Aging strip — the standard AR view */}
      <div className="stat-grid" style={{ marginBottom: 20 }}>
        {buckets.map((b) => (
          <div key={b.label} className="panel" style={{ padding: "12px 14px" }}>
            <div style={{ fontSize: 11.5, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--faint)" }}>
              {b.label}
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: b.label === "Current" || b.total === 0 ? undefined : "var(--orange, #fb923c)" }}>
              {formatEuro(b.total)}
            </div>
            <div style={{ fontSize: 12, color: "var(--faint)" }}>{b.count} item{b.count === 1 ? "" : "s"}</div>
          </div>
        ))}
      </div>

      {items.length === 0 ? (
        <section className="panel panel-block">
          <p className="empty-state" style={{ margin: 0 }}>
            Nobody owes you right now. Invoices you send from{" "}
            <Link href="/tradeos">TradeIQ</Link> and scanned receivables land
            here automatically once they&apos;re out.
          </p>
        </section>
      ) : (
        <section className="panel panel-block">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Ref</th>
                  <th>Due</th>
                  <th style={{ textAlign: "right" }}>Amount</th>
                  <th>Next step</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => {
                  const over = daysOverdue(i.due, today);
                  const stage = chaseStage(over);
                  return (
                    <tr key={i.key}>
                      <td><strong>{i.who}</strong></td>
                      <td style={{ fontSize: 13 }}>
                        {i.invoiceHref ? <Link href={i.invoiceHref}>{i.ref}</Link> : i.ref}
                      </td>
                      <td style={{ fontSize: 13, whiteSpace: "nowrap" }}>
                        {i.due ?? "—"}
                        {over > 0 && (
                          <span className="badge badge-red" style={{ marginLeft: 6 }}>{over}d overdue</span>
                        )}
                      </td>
                      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatEuro(i.total)}</td>
                      <td>
                        {stage.stage === "not_due" ? (
                          <span style={{ fontSize: 12.5, color: "var(--faint)" }}>Not due yet</span>
                        ) : i.expenseId ? (
                          <ReceivableChase expenseId={i.expenseId} stageLabel={stage.label} />
                        ) : (
                          <Link href={i.invoiceHref!} className="btn btn-secondary btn-sm">
                            {stage.label} →
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: 12, color: "var(--faint)", margin: "10px 0 0" }}>
            The ladder: friendly reminder up to 2 weeks late, firm chase to 6
            weeks, final notice after that. Drafts are written for you — nothing
            sends itself.{" "}
            <span className="badge badge-gray">Scheduled auto-chasing — not available yet</span>
          </p>
        </section>
      )}
    </>
  );
}
