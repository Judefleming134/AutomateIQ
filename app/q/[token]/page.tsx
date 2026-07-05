import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import type { QuoteLine } from "@/lib/quote-agent/create-core";
import { QuoteDecision } from "./decision";

export const dynamic = "force-dynamic";

/**
 * Public, no-auth quote page. The customer opens the link from their email,
 * the quote is marked 'viewed', and they accept or decline online. Uses the
 * service-role client (visitors have no session); lookup is by the
 * unguessable view_token.
 */
export default async function PublicQuotePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const admin = createAdminClient();

  const { data: quote } = await admin
    .from("qa_quotes")
    .select(
      "id, business_id, customer_name, job_description, quote_lines, total, notes, status, valid_until, viewed_at"
    )
    .eq("view_token", token)
    .maybeSingle();

  if (!quote) notFound();

  const { data: business } = await admin
    .from("businesses")
    .select("name, logo_url, email_signature")
    .eq("id", quote.business_id)
    .single();

  // First open → mark viewed (never downgrade an accepted/declined quote).
  if (!quote.viewed_at && ["draft", "sent"].includes(quote.status)) {
    await admin
      .from("qa_quotes")
      .update({ viewed_at: new Date().toISOString(), status: "viewed" })
      .eq("id", quote.id);
  }

  const lines = (quote.quote_lines as QuoteLine[]) ?? [];
  const decided = quote.status === "accepted" || quote.status === "declined";

  return (
    <main className="quote-public">
      <div className="quote-doc">
        <header className="quote-doc-head">
          {business?.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={business.logo_url} alt={business?.name ?? ""} className="quote-logo" />
          ) : (
            <span className="quote-biz">{business?.name ?? "Your quote"}</span>
          )}
          <span className={`quote-status quote-status-${quote.status}`}>
            {quote.status}
          </span>
        </header>

        <h1>Quote for {quote.customer_name}</h1>
        <p className="quote-job">{quote.job_description}</p>

        <table className="quote-doc-table">
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td>{l.item}</td>
                <td>{l.price}</td>
              </tr>
            ))}
            {quote.total && (
              <tr className="quote-doc-total">
                <td>Total</td>
                <td>{quote.total}</td>
              </tr>
            )}
          </tbody>
        </table>

        {quote.notes && <p className="quote-notes">{quote.notes}</p>}
        {quote.valid_until && (
          <p className="quote-valid">
            Valid until {new Date(quote.valid_until).toLocaleDateString("en-IE")}
          </p>
        )}

        {decided ? (
          <div className={`quote-decided quote-decided-${quote.status}`}>
            {quote.status === "accepted"
              ? "✓ You've accepted this quote — thank you! We'll be in touch to get started."
              : "This quote was declined. Changed your mind? Just reply to the email and we'll help."}
          </div>
        ) : (
          <QuoteDecision token={token} />
        )}

        <footer className="quote-doc-foot">
          {business?.email_signature || business?.name}
          <span className="quote-powered">Powered by AutomateIQ</span>
        </footer>
      </div>
    </main>
  );
}
