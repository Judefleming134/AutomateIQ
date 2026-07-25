"use client";

import { useActionState } from "react";
import { Landmark } from "lucide-react";
import { setBankBalance } from "@/app/tradeos/actions";

/**
 * Manual bank-balance entry — the forecast's starting point until the
 * open-banking feed replaces it. The set-at stamp keeps staleness honest.
 */
export function BankBalanceForm({
  balance,
  setAt,
}: {
  balance: number | null;
  setAt: string | null;
}) {
  const [state, action, pending] = useActionState(setBankBalance, undefined);
  return (
    <form action={action} className="panel panel-block">
      <h2 className="panel-title">
        <Landmark size={16} style={{ verticalAlign: "-3px" }} /> Current bank balance
      </h2>
      <p style={{ fontSize: 13, color: "var(--faint)", marginTop: 0 }}>
        The 13-week forecast starts from this number. Update it whenever you
        check the bank — the live feed will do this automatically once bank
        connections launch.
      </p>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <input
          name="balance"
          inputMode="decimal"
          defaultValue={balance != null ? String(balance) : ""}
          placeholder="e.g. 12500.50"
          style={{ maxWidth: 200 }}
          aria-label="Current bank balance in euro"
        />
        <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>
          {pending ? "Saving…" : "Save balance"}
        </button>
        {setAt && (
          <span style={{ fontSize: 12, color: "var(--faint)" }}>
            last set {setAt.slice(0, 10)}
          </span>
        )}
      </div>
      {state?.error && (
        <p style={{ color: "var(--red, #f87171)", fontSize: 13, margin: "8px 0 0" }}>{state.error}</p>
      )}
      {state?.ok && (
        <p style={{ color: "var(--green, #34d399)", fontSize: 13, margin: "8px 0 0" }}>✓ Saved — the forecast uses it now.</p>
      )}
    </form>
  );
}
