import { requireTradesAccount } from "@/lib/trades/data";
import { FinanceDashboard, ScanCta } from "@/components/trades/finance-dashboard";

export const metadata = { title: "Finance · TradeIQ" };

// The audit runs one AI call inside this route's actions.
export const maxDuration = 60;

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<{ claimed?: string }>;
}) {
  const { supabase } = await requireTradesAccount();
  const { claimed } = await searchParams;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Finance</h1>
          <p>
            Money in, money out, and where to save — built from your scanned
            bills and TradeIQ invoices.
          </p>
        </div>
        <ScanCta href="/tradeiq/scan" />
      </div>
      <FinanceDashboard supabase={supabase} claimed={claimed} scanHref="/tradeiq/scan" />
    </>
  );
}
