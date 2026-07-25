import { formatEuro, DOCUMENT_STATUS_META } from "@/lib/trades/core";

/**
 * The branded quote/invoice itself — pure and presentational, shared by the
 * tradesperson's internal view and the public customer page so both show the
 * exact same document. Styled to read cleanly on screen and when printed.
 */

export type DocAccount = {
  business_name: string;
  trade: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  vat_number: string | null;
};
export type DocCustomer = {
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
} | null;
export type DocLine = {
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
};
export type DocRecord = {
  kind: "quote" | "invoice";
  number: string;
  status: string;
  issued_at: string | null;
  due_at: string | null;
  subtotal: number;
  vat_rate: number;
  vat_amount: number;
  total: number;
  notes: string | null;
};

export function DocumentView({
  account,
  customer,
  doc,
  lines,
}: {
  account: DocAccount;
  customer: DocCustomer;
  doc: DocRecord;
  lines: DocLine[];
}) {
  const title = doc.kind === "quote" ? "Quote" : "Invoice";
  const meta = DOCUMENT_STATUS_META[doc.status];
  return (
    <div className="trades-doc panel panel-block">
      <div className="trades-doc-top">
        <div>
          <div className="trades-doc-biz">{account.business_name || "Your business"}</div>
          {account.trade && <div className="trades-doc-sub">{account.trade}</div>}
          <div className="trades-doc-sub">
            {[account.address, account.phone, account.email].filter(Boolean).join(" · ")}
          </div>
          {account.vat_number && <div className="trades-doc-sub">VAT {account.vat_number}</div>}
        </div>
        <div className="trades-doc-headright">
          <div className="trades-doc-kind">{title}</div>
          <div className="trades-doc-num">{doc.number}</div>
          <span className={`badge ${meta?.badge ?? "badge-gray"}`}>{meta?.label ?? doc.status}</span>
        </div>
      </div>

      <div className="trades-doc-meta">
        <div>
          <div className="trades-doc-label">Billed to</div>
          <div className="trades-doc-strong">{customer?.name ?? "—"}</div>
          <div className="trades-doc-sub">
            {[customer?.address, customer?.phone, customer?.email].filter(Boolean).join(" · ")}
          </div>
        </div>
        <div className="trades-doc-dates">
          <div><span className="trades-doc-label">Issued</span> {doc.issued_at ?? "—"}</div>
          <div>
            <span className="trades-doc-label">{doc.kind === "quote" ? "Valid until" : "Due"}</span>{" "}
            {doc.due_at ?? "—"}
          </div>
        </div>
      </div>

      <div className="table-wrap">
        <table className="trades-doc-table">
          <thead>
            <tr>
              <th>Description</th>
              <th style={{ textAlign: "right", width: 70 }}>Qty</th>
              <th style={{ textAlign: "right", width: 110 }}>Unit</th>
              <th style={{ textAlign: "right", width: 120 }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td>{l.description || "—"}</td>
                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{l.quantity}</td>
                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatEuro(Number(l.unit_price))}</td>
                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatEuro(Number(l.amount))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="trades-doc-totals">
        <div><span>Subtotal</span><span style={{ fontVariantNumeric: "tabular-nums" }}>{formatEuro(Number(doc.subtotal))}</span></div>
        <div><span>VAT ({Number(doc.vat_rate)}%)</span><span style={{ fontVariantNumeric: "tabular-nums" }}>{formatEuro(Number(doc.vat_amount))}</span></div>
        <div className="trades-doc-grand"><span>Total</span><span style={{ fontVariantNumeric: "tabular-nums" }}>{formatEuro(Number(doc.total))}</span></div>
      </div>

      {doc.notes && (
        <div className="trades-doc-notes">
          <div className="trades-doc-label">Notes</div>
          <p>{doc.notes}</p>
        </div>
      )}
    </div>
  );
}
