import { requireTradesAccount } from "@/lib/trades/data";
import { FinanceDashboard, ScanCta } from "@/components/trades/finance-dashboard";

export const metadata = { title: "Dashboard · AutomateIQ Finance" };

// The audit runs one AI call inside this route's actions.
export const maxDuration = 60;

export default async function FinanceHomePage({
  searchParams,
}: {
  searchParams: Promise<{ claimed?: string }>;
}) {
  const { supabase } = await requireTradesAccount("/finance/login");
  const { claimed } = await searchParams;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Finance</h1>
          <p>
            Money in, money out, and where to save — complete transparency over
            your scanned bills and invoices.
          </p>
        </div>
        <ScanCta href="/finance/scan" />
      </div>
      <FinanceDashboard supabase={supabase} claimed={claimed} scanHref="/finance/scan" />
    </>
  );
}
