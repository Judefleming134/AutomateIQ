"use client";

import { useState, useTransition } from "react";
import { CreditCard, ShieldCheck, Settings } from "lucide-react";
import { startCheckout, openBillingPortal } from "@/app/portal/billing/actions";

/**
 * Activation / manage-billing controls. Inactive businesses get an "Activate"
 * button → Stripe Checkout; active ones get "Manage billing" → Stripe Billing
 * Portal. Both redirect to Stripe-hosted pages, so no card data ever touches
 * this app.
 */
export function BillingActivation({ active }: { active: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const go = (action: typeof startCheckout) =>
    start(async () => {
      setError(null);
      const res = await action().catch(() => ({
        ok: false as const,
        error: "Something went wrong — try again.",
      }));
      if (res.ok) window.location.href = res.url;
      else setError(res.error);
    });

  if (active) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--green, #34d399)", fontWeight: 600 }}>
          <ShieldCheck size={16} /> Account active
        </span>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={pending}
          onClick={() => go(openBillingPortal)}
        >
          <Settings size={14} /> {pending ? "Opening…" : "Manage billing"}
        </button>
        {error && <span style={{ fontSize: 12, color: "var(--orange, #fb923c)" }}>{error}</span>}
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        className="btn btn-primary"
        disabled={pending}
        onClick={() => go(startCheckout)}
      >
        <CreditCard size={15} /> {pending ? "Opening secure checkout…" : "Activate your account"}
      </button>
      <p style={{ fontSize: 12, color: "var(--faint)", margin: "8px 0 0" }}>
        Secure payment by Stripe. Your card details never touch AutomateIQ.
      </p>
      {error && (
        <p style={{ fontSize: 12, color: "var(--orange, #fb923c)", margin: "6px 0 0" }}>{error}</p>
      )}
    </div>
  );
}
