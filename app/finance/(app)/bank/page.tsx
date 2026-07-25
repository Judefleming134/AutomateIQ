import { Landmark } from "lucide-react";
import { requireTradesAccount } from "@/lib/trades/data";
import { BankBalanceForm } from "@/components/trades/bank-balance-form";

export const metadata = { title: "Bank · AutomateIQ Finance" };

export default async function BankPage() {
  const { account } = await requireTradesAccount("/finance/login");
  return (
    <>
      <div className="page-header">
        <div>
          <h1>
            <Landmark size={20} style={{ verticalAlign: "-3px", marginRight: 8 }} />
            Bank &amp; feeds
          </h1>
          <p>Your balance powers the forecast today; live bank connections are next.</p>
        </div>
      </div>

      <div className="grid-2">
        <BankBalanceForm
          balance={account.bank_balance != null ? Number(account.bank_balance) : null}
          setAt={account.bank_balance_set_at ?? null}
        />

        <div style={{ display: "grid", gap: 16 }}>
          <section className="panel panel-block" style={{ opacity: 0.85 }}>
            <h2 className="panel-title">
              Live bank connection <span className="badge badge-gray">Not available yet</span>
            </h2>
            <p style={{ fontSize: 13, color: "var(--faint)", margin: 0 }}>
              Connect your Irish bank account (open banking) so the balance and
              transactions flow in live — no manual updates. Coming to Finance
              soon; your data stays read-only and yours.
            </p>
          </section>
          <section className="panel panel-block" style={{ opacity: 0.85 }}>
            <h2 className="panel-title">
              Auto-reconciliation <span className="badge badge-gray">Not available yet</span>
            </h2>
            <p style={{ fontSize: 13, color: "var(--faint)", margin: 0 }}>
              Bank transactions matched to your bills and invoices
              automatically — paid things mark themselves paid. Lands together
              with the bank connection.
            </p>
          </section>
          <section className="panel panel-block" style={{ opacity: 0.85 }}>
            <h2 className="panel-title">
              SEPA payment runs <span className="badge badge-gray">Not available yet</span>
            </h2>
            <p style={{ fontSize: 13, color: "var(--faint)", margin: 0 }}>
              Select approved bills, pay them in one batch. Planned once bank
              connections are live.
            </p>
          </section>
        </div>
      </div>
    </>
  );
}
