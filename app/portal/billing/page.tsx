import { Send, MessageSquare, Users, FileText, Lock } from "lucide-react";
import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";
import { StatCard } from "@/components/portal/stat-card";
import { isStripeConfigured } from "@/lib/billing/stripe";
import { BillingActivation } from "@/components/portal/billing-activation";
import {
  SETUP_PAYMENT_LINK,
  MONTHLY_PAYMENT_LINK,
  isSetupPaid,
} from "@/lib/billing/payment-links";

export default async function BillingPage() {
  const { profile } = await requireSession();
  const supabase = await createClient();

  const stripeOn = isStripeConfigured();
  // Read the billing stage (guarded — degrades to 'inactive' if migration 0021
  // hasn't run). Drives both the integrated-Stripe UI and the payment-link UI.
  let subscriptionStatus = "inactive";
  {
    const { data: biz, error } = await supabase
      .from("businesses")
      .select("subscription_status")
      .eq("id", profile.business_id!)
      .maybeSingle();
    if (!error && biz) subscriptionStatus = (biz.subscription_status as string) ?? "inactive";
  }
  const active = subscriptionStatus === "active";
  const setupPaid = isSetupPaid(subscriptionStatus);

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const since = monthStart.toISOString();

  // This-month usage — real RLS-scoped counts.
  const [{ count: requests }, { count: aiMessages }, { count: leads }] =
    await Promise.all([
      supabase
        .from("ra_review_requests")
        .select("id", { count: "exact", head: true })
        .gte("created_at", since),
      supabase
        .from("aa_messages")
        .select("id", { count: "exact", head: true })
        .gte("created_at", since),
      supabase
        .from("wa_leads")
        .select("id", { count: "exact", head: true })
        .gte("created_at", since),
    ]);

  const monthName = new Date().toLocaleDateString("en-IE", {
    month: "long",
    year: "numeric",
  });

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Billing</h1>
          <p>Your plan, usage and invoices.</p>
        </div>
      </div>

      {stripeOn ? (
        <div className="panel panel-block" style={{ marginBottom: 26 }}>
          <h2 className="panel-title">
            <span><span className="sys-index">01 /</span>Your plan</span>
            <span className={`badge ${active ? "badge-green" : "badge-gray"}`}>
              {active
                ? "Active"
                : subscriptionStatus === "past_due"
                  ? "Payment due"
                  : "Not active"}
            </span>
          </h2>
          {!active && (
            <p style={{ margin: "0 0 14px", fontSize: 13.5, color: "var(--body)", maxWidth: "60ch" }}>
              Activate your account to switch on your AI Assistant and Voice
              Agent. It&apos;s a one-off setup fee plus your monthly plan, paid
              securely through Stripe.
            </p>
          )}
          {active && (
            <p style={{ margin: "0 0 14px", fontSize: 13.5, color: "var(--body)", maxWidth: "60ch" }}>
              You&apos;re all set. Manage your card, plan or invoices any time
              through the secure billing portal.
            </p>
          )}
          <BillingActivation active={active} />
        </div>
      ) : (
        <div className="panel panel-block" style={{ marginBottom: 26 }}>
          <h2 className="panel-title">
            <span><span className="sys-index">01 /</span>Your plan</span>
            <span className={`badge ${active ? "badge-green" : setupPaid ? "badge-blue" : "badge-gray"}`}>
              {active ? "Active" : setupPaid ? "Setup paid" : "Not active"}
            </span>
          </h2>
          <p style={{ margin: "0 0 14px", fontSize: 13.5, color: "var(--body)", maxWidth: "60ch" }}>
            Two steps: a one-off setup fee, then your monthly plan — both paid
            securely through Stripe.
          </p>
          <div style={{ display: "grid", gap: 12 }}>
            {/* Setup fee */}
            <div
              className="panel"
              style={{ padding: "14px 16px", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}
            >
              <div style={{ flex: "1 1 240px" }}>
                <strong>Setup &amp; onboarding</strong>
                <div style={{ fontSize: 12.5, color: "var(--faint)" }}>
                  One-off €349 — building your agent, connecting your number, and your portal.
                </div>
              </div>
              {setupPaid ? (
                <span className="badge badge-green">✓ Paid</span>
              ) : (
                <a href={SETUP_PAYMENT_LINK} target="_blank" rel="noreferrer" className="btn btn-primary btn-sm">
                  Pay setup fee →
                </a>
              )}
            </div>
            {/* Monthly plan — locked until the setup fee is paid */}
            <div
              className="panel"
              style={{
                padding: "14px 16px",
                display: "flex",
                gap: 12,
                alignItems: "center",
                flexWrap: "wrap",
                opacity: setupPaid ? 1 : 0.72,
              }}
            >
              <div style={{ flex: "1 1 240px" }}>
                <strong>Monthly plan</strong>
                <div style={{ fontSize: 12.5, color: "var(--faint)" }}>
                  €129/month — your Voice Agent + AI Assistant.
                </div>
              </div>
              {active ? (
                <span className="badge badge-green">✓ Active</span>
              ) : setupPaid ? (
                <a href={MONTHLY_PAYMENT_LINK} target="_blank" rel="noreferrer" className="btn btn-primary btn-sm">
                  Start monthly plan →
                </a>
              ) : (
                <span
                  className="badge badge-gray"
                  style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
                >
                  <Lock size={11} /> Unlocks once your setup fee is paid
                </span>
              )}
            </div>
          </div>
          <p style={{ margin: "12px 0 0", fontSize: 12, color: "var(--faint)" }}>
            Questions about billing? Email{" "}
            <a href="mailto:hello@automateiq.ie" style={{ color: "var(--ac2)" }}>
              hello@automateiq.ie
            </a>{" "}
            and we&apos;ll sort it same-day.
          </p>
        </div>
      )}

      <h2 className="section-title">Usage — {monthName}</h2>
      <div className="stat-grid">
        <StatCard label="Review requests" value={requests ?? 0} icon={<Send />} accent="#7C3AED" hint="this month" />
        <StatCard label="AI messages" value={aiMessages ?? 0} icon={<MessageSquare />} accent="#3B82F6" hint="this month" />
        <StatCard label="Leads captured" value={leads ?? 0} icon={<Users />} accent="#0891B2" hint="this month" />
      </div>

      <div className="panel panel-block">
        <h2 className="panel-title">
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <FileText size={15} /> Invoices
          </span>
        </h2>
        <p className="empty-state">
          Invoices will appear here once in-portal billing launches. Until
          then they&apos;re emailed to you directly.
        </p>
      </div>
    </>
  );
}
