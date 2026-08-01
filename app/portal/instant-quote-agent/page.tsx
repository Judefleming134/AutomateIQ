import { Calculator, FileText, TrendingUp, BadgeEuro } from "lucide-react";
import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";
import { StatCard } from "@/components/portal/stat-card";
import { ActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/admin/submit-button";
import { QuoteGenerator } from "./generator";
import { QuoteRow } from "./quote-row";
import { CreateInvoiceButton, InvoiceCard, type InvoiceView } from "./invoice-panel";
import { isMissingTableError } from "@/lib/db/errors";
import { savePriceGuide } from "./actions";
import type { QuoteLine } from "@/lib/quote-agent/create-core";

// Best-effort numeric parse of a "€1,240" / "1240" style total for value sums.
function parseMoney(total: string | null): number {
  if (!total) return 0;
  const n = parseFloat(total.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export default async function InstantQuoteAgentPage() {
  const { profile } = await requireSession();
  const supabase = await createClient();

  const [{ data: settings }, { data: quotes }, invoiceResult] = await Promise.all([
    supabase
      .from("qa_settings")
      .select("price_guide")
      .eq("business_id", profile.business_id!)
      .maybeSingle(),
    supabase
      .from("qa_quotes")
      .select(
        "id, customer_name, customer_email, job_description, quote_lines, total, notes, status, sent_at, viewed_at, decided_at, created_at"
      )
      .order("created_at", { ascending: false })
      .limit(50),
    // Invoices, keyed by the quote they came from. Tolerates 0037 not being
    // run yet: the panel simply doesn't appear rather than the page failing.
    supabase
      .from("qa_invoices")
      .select(
        "id, quote_id, number, customer_name, customer_email, amount_cents, paid_amount_cents, currency, status, due_date, view_token"
      )
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  const invoicingReady = !isMissingTableError(invoiceResult.error);
  const invoiceByQuote = new Map<string, InvoiceView>();
  for (const inv of invoiceResult.data ?? []) {
    if (inv.quote_id && !invoiceByQuote.has(inv.quote_id)) {
      invoiceByQuote.set(inv.quote_id, inv as InvoiceView);
    }
  }
  const today = new Date().toISOString().slice(0, 10);

  const hasPriceGuide = Boolean(settings?.price_guide?.trim());
  const all = quotes ?? [];

  // Pipeline metrics — a real sales dashboard, not just a count.
  const accepted = all.filter((q) => q.status === "accepted");
  const live = all.filter((q) => ["sent", "viewed"].includes(q.status ?? ""));
  const decided = all.filter((q) =>
    ["accepted", "declined"].includes(q.status ?? "")
  );
  const acceptanceRate =
    decided.length > 0
      ? `${Math.round((accepted.length / decided.length) * 100)}%`
      : "—";
  const wonValue = accepted.reduce((s, q) => s + parseMoney(q.total), 0);
  const openValue = live.reduce((s, q) => s + parseMoney(q.total), 0);
  const euro = (n: number) =>
    n > 0 ? `€${n.toLocaleString("en-IE", { maximumFractionDigits: 0 })}` : "—";

  return (
    <>
      <div className="page-header">
        <div>
          <h1>QuoteIQ</h1>
          <p>
            Price a job in seconds, send a branded quote your customer can
            accept online, and watch it move from sent to won.
          </p>
        </div>
      </div>

      <div className="stat-grid">
        <StatCard
          label="Won value"
          value={euro(wonValue)}
          icon={<BadgeEuro />}
          accent="#34D399"
          hint={`${accepted.length} accepted`}
        />
        <StatCard
          label="Open value"
          value={euro(openValue)}
          icon={<TrendingUp />}
          accent="#3B82F6"
          hint={`${live.length} awaiting decision`}
        />
        <StatCard
          label="Acceptance rate"
          value={acceptanceRate}
          icon={<Calculator />}
          accent="#7C3AED"
          hint={`${decided.length} decided`}
        />
        <StatCard
          label="Price guide"
          value={hasPriceGuide ? "Set" : "Missing"}
          icon={<FileText />}
          accent={hasPriceGuide ? "#34D399" : "#FB923C"}
          hint={hasPriceGuide ? "quotes use your prices" : "add it below"}
        />
      </div>

      <div className="grid-main-side">
        <QuoteGenerator hasPriceGuide={hasPriceGuide} />

        <ActionForm action={savePriceGuide} className="panel form-card">
          <h2 className="panel-title" style={{ marginBottom: 4 }}>
            <span>
              <span className="sys-index">02 /</span>Your price guide
            </span>
          </h2>
          <p style={{ margin: "0 0 6px", fontSize: 12.5, color: "var(--faint)" }}>
            Services, rates, call-out fees, materials — anything you charge
            for. The agent never quotes a price that isn&apos;t here.
          </p>
          <div className="field">
            <label htmlFor="priceGuide">Prices &amp; rates</label>
            <textarea
              id="priceGuide"
              name="priceGuide"
              rows={9}
              placeholder={"Call-out fee: €80\nHourly rate: €95\nBathroom sink replacement: €220 incl. parts\nBath re-seal: €120\n..."}
              defaultValue={settings?.price_guide ?? ""}
            />
          </div>
          <div className="form-actions">
            <SubmitButton pendingText="Saving…">Save price guide</SubmitButton>
          </div>
        </ActionForm>
      </div>

      <h2 className="section-title">Quote pipeline</h2>
      {all.length === 0 ? (
        <div className="panel panel-block">
          <p className="empty-state">
            No quotes yet — create your first one above.
          </p>
        </div>
      ) : (
        <div className="content-library">
          {all.map((quote) => (
            <div key={quote.id}>
            <QuoteRow
              quote={{
                id: quote.id,
                customerName: quote.customer_name,
                customerEmail: quote.customer_email,
                jobDescription: quote.job_description,
                lines: (quote.quote_lines as QuoteLine[]) ?? [],
                total: quote.total,
                notes: quote.notes,
                status: quote.status ?? "draft",
                createdAt: quote.created_at,
              }}
            />
            {/* The money half. An accepted quote can be turned into an invoice
                in one step — the thing /products/tradeiq has been selling —
                and once raised, the invoice lives beside the quote it came
                from rather than in a separate ledger to reconcile. */}
            {invoicingReady && quote.status === "accepted" && (
              invoiceByQuote.has(quote.id) ? (
                <InvoiceCard invoice={invoiceByQuote.get(quote.id)!} today={today} />
              ) : (
                <div style={{ margin: "8px 0 0 2px" }}>
                  <CreateInvoiceButton quoteId={quote.id} />
                </div>
              )
            )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
