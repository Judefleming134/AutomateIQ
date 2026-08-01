import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  formatCents,
  displayStatus,
  daysOverdue,
  outstandingCents,
  coerceLines,
  STATUS_META,
} from "@/lib/quote-agent/invoice";

/**
 * The invoice a customer opens. No login — the unguessable view_token is the
 * key, the same pattern the quote page already uses.
 *
 * Deliberately not indexed and never cached: an invoice is a private document
 * about one person's money, and a stale copy showing "unpaid" after they have
 * paid is a bad phone call for the business.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Invoice",
  robots: { index: false, follow: false },
};

export default async function PublicInvoicePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  // Token shape is checked before it reaches the database, so a junk URL is a
  // 404 rather than a query.
  if (!/^[0-9a-f-]{36}$/i.test(token)) notFound();

  const admin = createAdminClient();
  const { data: invoice } = await admin
    .from("qa_invoices")
    .select(
      "id, business_id, number, customer_name, lines, amount_cents, currency, status, notes, due_date, paid_amount_cents, created_at"
    )
    .eq("view_token", token)
    .maybeSingle();
  if (!invoice) notFound();

  // A voided invoice must not read as a live demand for money.
  const { data: business } = await admin
    .from("businesses")
    .select("name, logo_url, email_signature")
    .eq("id", invoice.business_id)
    .maybeSingle();

  const today = new Date().toISOString().slice(0, 10);
  const shown = displayStatus(invoice, today);
  const meta = STATUS_META[shown];
  const late = daysOverdue(invoice, today);
  const owed = outstandingCents(invoice);
  const lines = coerceLines(invoice.lines);
  const currency = invoice.currency ?? "EUR";

  return (
    <div className="book-page" style={{ maxWidth: 720, margin: "0 auto", padding: "32px 20px 64px" }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "flex-start", marginBottom: 28 }}>
        <div>
          {business?.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={business.logo_url} alt={business.name ?? ""} style={{ maxHeight: 48, marginBottom: 8 }} />
          ) : (
            <h2 style={{ margin: "0 0 4px", fontSize: 20 }}>{business?.name ?? "Invoice"}</h2>
          )}
          <p style={{ margin: 0, fontSize: 13, color: "var(--faint)" }}>
            Invoice <strong>{invoice.number}</strong>
          </p>
        </div>
        <span className={`badge ${meta.badge}`} style={{ fontSize: 13 }}>
          {meta.label}
        </span>
      </header>

      {shown === "void" && (
        <div className="panel panel-block" style={{ borderLeft: "3px solid var(--faint)", marginBottom: 20 }}>
          <p style={{ margin: 0, fontSize: 14 }}>
            This invoice has been cancelled. Nothing is owed on it.
          </p>
        </div>
      )}

      <div className="panel panel-block" style={{ marginBottom: 20 }}>
        <p style={{ margin: "0 0 4px", fontSize: 13, color: "var(--faint)" }}>Billed to</p>
        <p style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 600 }}>{invoice.customer_name}</p>

        {lines.length > 0 && (
          <div style={{ borderTop: "1px solid var(--line, rgba(255,255,255,.08))" }}>
            {lines.map((l, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 16,
                  padding: "10px 0",
                  borderBottom: "1px solid var(--line, rgba(255,255,255,.06))",
                  fontSize: 14.5,
                }}
              >
                <span>{l.item}</span>
                <span style={{ whiteSpace: "nowrap" }}>{l.price}</span>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, marginTop: 16, fontSize: 20, fontWeight: 700 }}>
          <span>Total</span>
          <span>{formatCents(invoice.amount_cents, currency)}</span>
        </div>

        {/* A part payment must be visible, or the customer pays twice. */}
        {(invoice.paid_amount_cents ?? 0) > 0 && shown !== "paid" && (
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, marginTop: 8, fontSize: 14, color: "var(--faint)" }}>
            <span>Already paid</span>
            <span>−{formatCents(invoice.paid_amount_cents ?? 0, currency)}</span>
          </div>
        )}
        {owed > 0 && (invoice.paid_amount_cents ?? 0) > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, marginTop: 6, fontSize: 16, fontWeight: 600 }}>
            <span>Still due</span>
            <span>{formatCents(owed, currency)}</span>
          </div>
        )}
      </div>

      {shown === "paid" ? (
        <p style={{ fontSize: 15, color: "var(--green, #34d399)", fontWeight: 600 }}>
          Paid in full — thank you. Nothing further is owed.
        </p>
      ) : shown !== "void" ? (
        <p style={{ fontSize: 14, lineHeight: 1.65 }}>
          {invoice.due_date && (
            <>
              Due <strong>{invoice.due_date}</strong>
              {late > 0 && (
                <span style={{ color: "var(--orange, #fb923c)" }}>
                  {" "}— {late} day{late === 1 ? "" : "s"} ago
                </span>
              )}
              .{" "}
            </>
          )}
          Please pay {formatCents(owed, currency)} using the details {business?.name ?? "the business"} gave
          you, quoting <strong>{invoice.number}</strong>.
        </p>
      ) : null}

      {invoice.notes && (
        <p style={{ fontSize: 13.5, color: "var(--faint)", whiteSpace: "pre-wrap", marginTop: 18 }}>
          {invoice.notes}
        </p>
      )}

      {business?.email_signature && (
        <p style={{ fontSize: 13, color: "var(--faint)", whiteSpace: "pre-wrap", marginTop: 24 }}>
          {business.email_signature}
        </p>
      )}
    </div>
  );
}
