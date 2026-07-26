import { Sparkles } from "lucide-react";
import { requireTradesAccount } from "@/lib/trades/data";
import { TradesAssistant } from "@/components/trades/trades-assistant";

export const metadata = { title: "Assistant · TradeOS" };

// Each answer runs one live AI call inside this route's actions.
export const maxDuration = 60;

export default async function TradesAssistantPage() {
  await requireTradesAccount();

  return (
    <>
      <div className="page-header">
        <div>
          <h1>
            <Sparkles size={20} style={{ verticalAlign: "-3px", marginRight: 8 }} />
            Assistant
          </h1>
          <p>
            Ask it anything about your business — it reads your live quotes,
            invoices, customers and bills, pulls any customer&apos;s details,
            and drafts quotes for you. You stay in charge: it never sends
            anything.
          </p>
        </div>
      </div>
      <TradesAssistant />
    </>
  );
}
