import Link from "next/link";
import { requireTradesAccount, needsOnboarding } from "@/lib/trades/data";
import { QuoteEditor } from "@/components/trades/quote-editor";

export const metadata = { title: "New quote · TradeIQ" };

export default async function NewQuotePage() {
  const { supabase, account } = await requireTradesAccount();
  const { data: customers } = await supabase
    .from("trades_customers")
    .select("id, name")
    .order("name");

  return (
    <>
      <div className="page-header">
        <div>
          <h1>New quote</h1>
          <p>Build it, then send it — you can turn it into an invoice in one tap later.</p>
        </div>
      </div>

      {needsOnboarding(account) && (
        <div className="panel panel-block" style={{ marginBottom: 16, borderLeft: "3px solid var(--orange, #fb923c)" }}>
          <p style={{ margin: 0, fontSize: 14 }}>
            Tip: set your business name and VAT rate in{" "}
            <Link href="/tradeos/settings">settings</Link> first so the quote looks right.
          </p>
        </div>
      )}

      <QuoteEditor customers={customers ?? []} vatRate={Number(account.vat_rate)} />
    </>
  );
}
