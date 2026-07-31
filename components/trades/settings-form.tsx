"use client";

import { useActionState } from "react";
import { saveSettings } from "@/app/tradeiq/actions";
import type { TradesAccount } from "@/lib/trades/data";

export function SettingsForm({ account }: { account: TradesAccount }) {
  const [state, action, pending] = useActionState(saveSettings, undefined);
  return (
    <form action={action} className="panel panel-block">
      <div className="grid-2">
        <div>
          <label htmlFor="bn">Business name *</label>
          <input id="bn" name="businessName" defaultValue={account.business_name} required maxLength={160} placeholder="e.g. Byrne Plumbing & Heating" />
          <label htmlFor="tr">Trade</label>
          <input id="tr" name="trade" defaultValue={account.trade ?? ""} maxLength={80} placeholder="e.g. Plumber, Electrician" />
          <label htmlFor="em">Email</label>
          <input id="em" name="email" type="email" defaultValue={account.email ?? ""} maxLength={200} placeholder="replies to your quotes go here" />
          <label htmlFor="ph">Phone</label>
          <input id="ph" name="phone" defaultValue={account.phone ?? ""} maxLength={60} />
          <label htmlFor="ad">Address</label>
          <input id="ad" name="address" defaultValue={account.address ?? ""} maxLength={400} />
        </div>
        <div>
          <label htmlFor="vr">VAT rate (%)</label>
          <input id="vr" name="vatRate" inputMode="decimal" defaultValue={String(account.vat_rate)} placeholder="e.g. 23 (or 0 if not registered)" />
          <label htmlFor="vn">VAT number</label>
          <input id="vn" name="vatNumber" defaultValue={account.vat_number ?? ""} maxLength={40} />
          <label htmlFor="pt">Payment terms (days)</label>
          <input id="pt" name="paymentTermsDays" inputMode="numeric" defaultValue={String(account.payment_terms_days)} placeholder="e.g. 14" />
          <p style={{ fontSize: 12, color: "var(--faint)", marginTop: 8 }}>
            Invoices are due this many days after you send them; quotes show it as “valid until”.
          </p>
        </div>
      </div>
      {state?.error && <p style={{ color: "var(--red, #f87171)", fontSize: 13, margin: "10px 0 0" }}>{state.error}</p>}
      {state?.ok && <p style={{ color: "var(--green, #34d399)", fontSize: 13, margin: "10px 0 0" }}>✓ Saved.</p>}
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? "Saving…" : "Save settings"}</button>
      </div>
    </form>
  );
}
