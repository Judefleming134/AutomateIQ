import { requireTradesAccount } from "@/lib/trades/data";
import { SettingsForm } from "@/components/trades/settings-form";

export const metadata = { title: "Settings · AutomateIQ Trades" };

export default async function TradesSettingsPage() {
  const { account } = await requireTradesAccount();
  return (
    <>
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p>Your business details — these appear on every quote and invoice.</p>
        </div>
      </div>
      <SettingsForm account={account} />
    </>
  );
}
