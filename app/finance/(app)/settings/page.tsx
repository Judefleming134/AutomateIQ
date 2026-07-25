import { requireTradesAccount } from "@/lib/trades/data";
import { SettingsForm } from "@/components/trades/settings-form";

export const metadata = { title: "Settings · AutomateIQ Finance" };

export default async function FinanceSettingsPage() {
  const { account } = await requireTradesAccount("/finance/login");
  return (
    <>
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p>
            Your business details — used on drafted emails, and shared with your
            TradeOS account (it&apos;s the same account).
          </p>
        </div>
      </div>
      <SettingsForm account={account} />
    </>
  );
}
