import { BarChart3 } from "lucide-react";
import { requireTradesAccount } from "@/lib/trades/data";
import { formatEuro } from "@/lib/trades/core";
import { recentMonths, vatPeriods } from "@/lib/finance/insights";

export const metadata = { title: "Reports · AutomateIQ Finance" };

export default async function ReportsPage() {
  const { supabase, account } = await requireTradesAccount("/finance/login");
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: invoices }, { data: expenses }] = await Promise.all([
    supabase
      .from("trades_documents")
      .select("status, total, vat_amount, issued_at, paid_at")
      .eq("kind", "invoice")
      .not("status", "in", '("void","declined")')
      .limit(1000),
    supabase
      .from("trades_expenses")
      .select("direction, total, vat_amount, issued_at, paid_at, status")
      .limit(1000),
  ]);
  const bills = (expenses ?? []).filter((e) => e.direction === "payable");

  const inRange = (d: string | null | undefined, start: string, end: string) =>
    !!d && d.slice(0, 10) >= start && d.slice(0, 10) <= end;

  // Month-by-month money view (most recent 6).
  const months = recentMonths(today, 6).map((m) => {
    const invoiced = (invoices ?? [])
      .filter((i) => inRange(i.issued_at, m.start, m.end))
      .reduce((s, i) => s + Number(i.total), 0);
    const collected = (invoices ?? [])
      .filter((i) => i.status === "paid" && inRange(i.paid_at, m.start, m.end))
      .reduce((s, i) => s + Number(i.total), 0);
    const billed = bills
      .filter((b) => inRange(b.issued_at, m.start, m.end))
      .reduce((s, b) => s + Number(b.total), 0);
    const paidOut = bills
      .filter((b) => b.status === "paid" && inRange(b.paid_at, m.start, m.end))
      .reduce((s, b) => s + Number(b.total), 0);
    return { ...m, invoiced, collected, billed, paidOut, net: collected - paidOut };
  });

  // Bi-monthly Irish VAT view (period totals from captured VAT amounts).
  const vat = vatPeriods(today, 3).map((p) => {
    const salesVat = (invoices ?? [])
      .filter((i) => inRange(i.issued_at, p.start, p.end))
      .reduce((s, i) => s + Number(i.vat_amount), 0);
    const purchaseVat = bills
      .filter((b) => inRange(b.issued_at, p.start, p.end))
      .reduce((s, b) => s + Number(b.vat_amount), 0);
    return { ...p, salesVat, purchaseVat, net: salesVat - purchaseVat };
  });

  return (
    <>
      <div className="page-header">
        <div>
          <h1>
            <BarChart3 size={20} style={{ verticalAlign: "-3px", marginRight: 8 }} />
            Reports
          </h1>
          <p>Month by month, plus your VAT position — straight from the records, nothing modelled.</p>
        </div>
      </div>

      <section className="panel panel-block" style={{ marginBottom: 16 }}>
        <h2 className="panel-title">Last 6 months</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Month</th>
                <th style={{ textAlign: "right" }}>Invoiced</th>
                <th style={{ textAlign: "right" }}>Collected</th>
                <th style={{ textAlign: "right" }}>Bills received</th>
                <th style={{ textAlign: "right" }}>Paid out</th>
                <th style={{ textAlign: "right" }}>Net cash</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m) => (
                <tr key={m.label}>
                  <td>{m.label}</td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatEuro(m.invoiced)}</td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--green, #34d399)" }}>{formatEuro(m.collected)}</td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatEuro(m.billed)}</td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--orange, #fb923c)" }}>{formatEuro(m.paidOut)}</td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: m.net < 0 ? "var(--red, #f87171)" : undefined }}>
                    {formatEuro(m.net)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ fontSize: 12, color: "var(--faint)", margin: "10px 0 0" }}>
          Collected/paid use actual payment dates; invoiced/billed use issue dates. Only what you&apos;ve
          recorded is counted — the more you scan, the truer this gets.
        </p>
      </section>

      <section className="panel panel-block">
        <h2 className="panel-title">VAT position (bi-monthly periods)</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Period</th>
                <th style={{ textAlign: "right" }}>VAT on sales</th>
                <th style={{ textAlign: "right" }}>VAT on purchases</th>
                <th style={{ textAlign: "right" }}>Net VAT</th>
              </tr>
            </thead>
            <tbody>
              {vat.map((p) => (
                <tr key={p.label}>
                  <td>{p.label}</td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatEuro(p.salesVat)}</td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatEuro(p.purchaseVat)}</td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>
                    {formatEuro(p.net)}{" "}
                    <span style={{ fontSize: 11.5, color: "var(--faint)", fontWeight: 400 }}>
                      {p.net >= 0 ? "likely owed to Revenue" : "likely reclaimable"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ fontSize: 12, color: "var(--faint)", margin: "10px 0 0" }}>
          An estimate from the VAT captured on your invoices and scanned bills
          {account.vat_number ? "" : " (no VAT number on file — set one in Settings if you're registered)"} —
          always confirm the actual VAT3 with your accountant.{" "}
          <span className="badge badge-gray">VAT3 export — not available yet</span>{" "}
          <span className="badge badge-gray">CSV export — not available yet</span>
        </p>
      </section>
    </>
  );
}
