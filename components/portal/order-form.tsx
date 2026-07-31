"use client";

import { useActionState } from "react";
import { saveOrderForm } from "@/app/portal/billing/actions";

type OrderFormResult = { ok?: boolean; error?: string } | undefined;

export type OrderFormData = {
  contact_name: string;
  phone: string;
  email: string;
  business_hours: string;
  service_area: string;
  agreed: boolean;
  agreed_name: string;
  agreed_at: string | null;
};

/**
 * The in-dashboard order form: the customer reviews the order, fills their
 * details, and confirms — all without leaving the portal. Once confirmed it's
 * binding and shown locked/read-only (the server action also refuses to change
 * an agreed form). Mirrors the paper order form.
 */
export function OrderForm({
  businessName,
  initial,
}: {
  businessName: string;
  initial: OrderFormData;
}) {
  const [state, formAction, pending] = useActionState<OrderFormResult, FormData>(
    saveOrderForm,
    undefined
  );

  const agreedDate = initial.agreed_at
    ? new Date(initial.agreed_at).toLocaleDateString("en-IE", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "";

  // ---- Locked (binding) view ------------------------------------------------
  if (initial.agreed) {
    return (
      <div className="panel panel-block" style={{ marginBottom: 26 }}>
        <h2 className="panel-title">
          <span>Your order</span>
          <span className="badge badge-green">✓ Confirmed</span>
        </h2>
        <p style={{ fontSize: 13.5, color: "var(--body)", margin: "0 0 14px" }}>
          Confirmed by <strong>{initial.agreed_name}</strong>
          {agreedDate ? ` on ${agreedDate}` : ""}. This order is now in place —
          we&apos;re building your AI receptionist.
        </p>
        <OrderSummary businessName={businessName} />
        <dl
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: 14,
            margin: "16px 0 0",
          }}
        >
          <Detail label="Contact" value={initial.contact_name} />
          <Detail label="Phone" value={initial.phone} />
          <Detail label="Email" value={initial.email} />
          <Detail label="Business hours" value={initial.business_hours} />
        </dl>
      </div>
    );
  }

  // ---- Editable view --------------------------------------------------------
  return (
    <div className="panel panel-block" style={{ marginBottom: 26 }}>
      <h2 className="panel-title">
        <span>Your order</span>
        <span className="badge badge-gray">Not confirmed</span>
      </h2>
      <p style={{ fontSize: 13.5, color: "var(--body)", margin: "0 0 14px", maxWidth: "62ch" }}>
        Review your order below, fill in your details, and confirm — all here, no
        paperwork. Once you confirm and pay the setup fee, we start building.
      </p>

      <OrderSummary businessName={businessName} />

      <form action={formAction}>
        <div
          style={{
            display: "grid",
            gap: 12,
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            marginBottom: 14,
          }}
        >
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="of-contact">Your name</label>
            <input id="of-contact" name="contact_name" type="text" defaultValue={initial.contact_name} maxLength={200} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="of-phone">Phone number</label>
            <input id="of-phone" name="phone" type="text" defaultValue={initial.phone} maxLength={60} placeholder="086…" />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="of-email">Email</label>
            <input id="of-email" name="email" type="email" defaultValue={initial.email} maxLength={200} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="of-hours">Business hours</label>
            <input id="of-hours" name="business_hours" type="text" defaultValue={initial.business_hours} maxLength={400} placeholder="Mon–Fri 8–6, emergency 24/7" />
          </div>
        </div>

        <div
          style={{
            border: "1px solid var(--line)",
            borderRadius: 10,
            padding: "14px 16px",
            background: "var(--bg2)",
          }}
        >
          <label
            htmlFor="of-agree"
            style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13.5, cursor: "pointer" }}
          >
            <input id="of-agree" name="agree" type="checkbox" style={{ marginTop: 3, flex: "none" }} />
            <span>
              I confirm this order for {businessName || "my business"} — the €349 setup
              and €129/month plan — and agree to the terms: rolling monthly, cancel any
              time with 30 days&apos; notice, prices held at the founding rate while
              subscribed.
            </span>
          </label>
          <div className="field" style={{ margin: "12px 0 0", maxWidth: 320 }}>
            <label htmlFor="of-signname">Type your full name to confirm</label>
            <input id="of-signname" name="agreed_name" type="text" defaultValue="" maxLength={200} placeholder="e.g. Jane Murphy" />
          </div>
        </div>

        {state?.error && <p className="login-error" style={{ marginTop: 10 }}>{state.error}</p>}
        {state?.ok && !pending && (
          <p style={{ color: "var(--green)", fontSize: 13, marginTop: 10 }}>✓ Saved</p>
        )}

        <div className="form-actions" style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>
            {pending ? "Saving…" : "Confirm order"}
          </button>
          <span style={{ fontSize: 12, color: "var(--faint)", alignSelf: "center" }}>
            Tick the box + type your name to make it binding. Leave the box unticked to
            just save your details for now.
          </span>
        </div>
      </form>
    </div>
  );
}

function OrderSummary({ businessName }: { businessName: string }) {
  return (
    <div
      style={{
        border: "1px solid var(--line)",
        borderRadius: 10,
        overflow: "hidden",
        marginBottom: 16,
      }}
    >
      <Row
        title="AI Voice Receptionist — Setup & Onboarding"
        desc={`Built, connected to ${businessName || "your"} number, and configured for you.`}
        amount="€349 one-off"
      />
      <Row
        title="Monthly Service — VoiceIQ + AssistIQ"
        desc="Live dashboard, call summaries, ongoing support. Rolling monthly."
        amount="€129 / month"
      />
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "12px 16px",
          background: "var(--bg2)",
          fontWeight: 700,
        }}
      >
        <span>Due today to go live</span>
        <span style={{ color: "var(--ac2)" }}>€349</span>
      </div>
    </div>
  );
}

function Row({ title, desc, amount }: { title: string; desc: string; amount: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
        alignItems: "flex-start",
        padding: "13px 16px",
        borderBottom: "1px solid var(--line)",
      }}
    >
      <div>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 12.5, color: "var(--faint)", marginTop: 2 }}>{desc}</div>
      </div>
      <div style={{ fontWeight: 700, whiteSpace: "nowrap", fontSize: 14 }}>{amount}</div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--faint)" }}>
        {label}
      </dt>
      <dd style={{ margin: "2px 0 0", fontSize: 14, color: "var(--heading)" }}>{value || "—"}</dd>
    </div>
  );
}
