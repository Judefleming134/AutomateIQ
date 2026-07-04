import { Send, MessageSquare, Users, FileText } from "lucide-react";
import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";
import { StatCard } from "@/components/portal/stat-card";

export default async function BillingPage() {
  await requireSession();
  const supabase = await createClient();

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

      <div className="panel panel-block" style={{ marginBottom: 26 }}>
        <h2 className="panel-title">
          <span><span className="sys-index">01 /</span>Your plan</span>
          <span className="badge badge-green">Active</span>
        </h2>
        <p style={{ margin: 0, fontSize: 13.5, color: "var(--body)", maxWidth: "60ch" }}>
          Your subscription is managed directly with AutomateIQ. In-portal
          invoices and card payments are coming soon — for plan changes,
          invoices or payment questions, email{" "}
          <a href="mailto:hello@automateiq.ie" style={{ color: "var(--ac2)" }}>
            hello@automateiq.ie
          </a>{" "}
          and we&apos;ll sort it same-day.
        </p>
      </div>

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
