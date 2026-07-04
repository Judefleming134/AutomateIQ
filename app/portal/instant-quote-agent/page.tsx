import { Calculator, FileText } from "lucide-react";
import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";
import { StatCard } from "@/components/portal/stat-card";
import { ActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/admin/submit-button";
import { QuoteGenerator } from "./generator";
import { savePriceGuide } from "./actions";
import type { QuoteLine } from "@/lib/quote-agent/create-core";

export default async function InstantQuoteAgentPage() {
  const { profile } = await requireSession();
  const supabase = await createClient();

  // RLS-scoped; reads empty until manual_update_0007.sql is run.
  const [{ data: settings }, { data: quotes }, { count: total }] =
    await Promise.all([
      supabase
        .from("qa_settings")
        .select("price_guide")
        .eq("business_id", profile.business_id!)
        .maybeSingle(),
      supabase
        .from("qa_quotes")
        .select("id, customer_name, job_description, quote_lines, total, notes, created_at")
        .order("created_at", { ascending: false })
        .limit(15),
      supabase.from("qa_quotes").select("id", { count: "exact", head: true }),
    ]);

  const hasPriceGuide = Boolean(settings?.price_guide?.trim());

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Instant Quote Agent</h1>
          <p>
            A job description in, an itemised quote out — priced strictly
            from your own price guide.
          </p>
        </div>
      </div>

      <div className="stat-grid">
        <StatCard
          label="Quotes created"
          value={total ?? 0}
          icon={<Calculator />}
          accent="#EA580C"
          hint="all time"
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

      <h2 className="section-title">Quote history</h2>
      {(quotes ?? []).length === 0 ? (
        <div className="panel panel-block">
          <p className="empty-state">
            No quotes yet — create your first one above.
          </p>
        </div>
      ) : (
        <div className="content-library">
          {(quotes ?? []).map((quote) => {
            const lines = (quote.quote_lines as QuoteLine[]) ?? [];
            return (
              <details key={quote.id} className="panel content-item">
                <summary>
                  <span className="badge badge-blue">
                    {quote.total || "quote"}
                  </span>
                  <span className="content-topic">
                    {quote.customer_name} — {quote.job_description.slice(0, 80)}
                  </span>
                  <span className="feed-time">
                    {new Date(quote.created_at).toLocaleDateString("en-IE", {
                      day: "numeric",
                      month: "short",
                    })}
                  </span>
                </summary>
                <table className="quote-table">
                  <tbody>
                    {lines.map((l, i) => (
                      <tr key={i}>
                        <td>{l.item}</td>
                        <td>{l.price}</td>
                      </tr>
                    ))}
                    {quote.total && (
                      <tr className="quote-total">
                        <td>Total</td>
                        <td>{quote.total}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
                {quote.notes && (
                  <p style={{ margin: "10px 0 0", fontSize: 12.5, color: "var(--body)" }}>
                    {quote.notes}
                  </p>
                )}
              </details>
            );
          })}
        </div>
      )}
    </>
  );
}
