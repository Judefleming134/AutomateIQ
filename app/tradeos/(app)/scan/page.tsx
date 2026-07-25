import { requireTradesAccount } from "@/lib/trades/data";
import { ScanFlow } from "@/components/trades/scan-flow";

export const metadata = { title: "Scan an invoice · TradeOS" };

// The scan runs one AI vision call inside this route's actions.
export const maxDuration = 60;

export default async function ScanPage() {
  await requireTradesAccount();
  return (
    <>
      <div className="page-header">
        <div>
          <h1>Scan an invoice</h1>
          <p>
            Photograph any invoice — it&apos;s read, filed under Finance, and the
            email you need is drafted for you.
          </p>
        </div>
      </div>
      <ScanFlow />
    </>
  );
}
