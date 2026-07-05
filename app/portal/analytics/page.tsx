import {
  Send,
  Users,
  MessageSquare,
  Zap,
  MousePointerClick,
  TrendingUp,
  PenLine,
  Calculator,
} from "lucide-react";
import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";
import { StatCard } from "@/components/portal/stat-card";
import {
  ActivityBarChart,
  DonutChart,
  bucketByDay,
} from "@/components/portal/activity-chart";

const DAYS = 14;

export default async function AnalyticsPage() {
  await requireSession();
  const supabase = await createClient();
  const since = new Date(Date.now() - (DAYS - 1) * 86_400_000).toISOString();

  // Every figure below is a real RLS-scoped query; module tables that
  // don't exist yet simply read 0.
  const [
    { count: requests },
    { count: clicked },
    { count: leads },
    { count: conversations },
    { count: aiMessages },
    { count: automations },
    { count: contentPieces },
    { count: quotes },
    { count: instantReplies },
    { data: requestRows },
    { data: leadRows },
    { data: msgRows },
  ] = await Promise.all([
    supabase
      .from("ra_review_requests")
      .select("id", { count: "exact", head: true })
      .in("status", ["sent", "reminded", "clicked"]),
    supabase
      .from("ra_review_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "clicked"),
    supabase.from("wa_leads").select("id", { count: "exact", head: true }),
    supabase.from("aa_conversations").select("id", { count: "exact", head: true }),
    supabase.from("aa_messages").select("id", { count: "exact", head: true }),
    supabase
      .from("ra_review_requests")
      .select("id", { count: "exact", head: true })
      .not("reminder_sent_at", "is", null),
    supabase.from("ca_content").select("id", { count: "exact", head: true }),
    supabase.from("qa_quotes").select("id", { count: "exact", head: true }),
    supabase.from("stl_replies").select("id", { count: "exact", head: true }),
    supabase.from("ra_review_requests").select("created_at").gte("created_at", since).limit(2000),
    supabase.from("wa_leads").select("created_at").gte("created_at", since).limit(2000),
    supabase.from("aa_messages").select("created_at").gte("created_at", since).limit(2000),
  ]);

  const conversionRate =
    (requests ?? 0) > 0
      ? `${Math.round(((clicked ?? 0) / (requests ?? 1)) * 100)}%`
      : "—";

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Analytics</h1>
          <p>
            One view across every agent — reviews, leads, AI usage, content,
            quotes and automations. Revenue tracking arrives with billing.
          </p>
        </div>
      </div>

      <div className="stat-grid">
        <StatCard label="Review requests" value={requests ?? 0} icon={<Send />} accent="#7C3AED" hint="all time" />
        <StatCard label="Review clicks" value={clicked ?? 0} icon={<MousePointerClick />} accent="#22D3EE" hint="all time" />
        <StatCard label="Conversion" value={conversionRate} icon={<TrendingUp />} accent="#34D399" hint="request → click" />
        <StatCard label="Website leads" value={leads ?? 0} icon={<Users />} accent="#0891B2" hint="all time" />
        <StatCard label="AI messages" value={aiMessages ?? 0} icon={<MessageSquare />} accent="#3B82F6" hint={`${conversations ?? 0} conversations`} />
        <StatCard label="Automations" value={automations ?? 0} icon={<Zap />} accent="#059669" hint="auto follow-ups" />
        <StatCard label="Content written" value={contentPieces ?? 0} icon={<PenLine />} accent="#EC4899" hint="all time" />
        <StatCard label="Quotes created" value={quotes ?? 0} icon={<Calculator />} accent="#EA580C" hint="all time" />
        <StatCard label="Instant lead replies" value={instantReplies ?? 0} icon={<Zap />} accent="#F59E0B" hint="under 60s each" />
      </div>

      <div className="grid-2">
        <div className="panel panel-block">
          <h2 className="panel-title">
            <span><span className="sys-index">01 /</span>Review requests — {DAYS} days</span>
          </h2>
          <ActivityBarChart
            buckets={bucketByDay((requestRows ?? []).map((r) => r.created_at), DAYS)}
            accent="var(--chart-1)"
          />
        </div>
        <div className="panel panel-block">
          <h2 className="panel-title">
            <span><span className="sys-index">02 /</span>Website leads — {DAYS} days</span>
          </h2>
          <ActivityBarChart
            buckets={bucketByDay((leadRows ?? []).map((r) => r.created_at), DAYS)}
            accent="var(--chart-3)"
            unit="leads"
          />
        </div>
      </div>

      <div className="grid-main-side">
        <div className="panel panel-block">
          <h2 className="panel-title">
            <span><span className="sys-index">03 /</span>AI activity — {DAYS} days</span>
          </h2>
          <ActivityBarChart
            buckets={bucketByDay((msgRows ?? []).map((r) => r.created_at), DAYS)}
            accent="var(--chart-2)"
            unit="messages"
          />
        </div>
        <div className="panel panel-block">
          <h2 className="panel-title">
            <span><span className="sys-index">04 /</span>Engagement mix</span>
          </h2>
          <DonutChart
            centerLabel="events"
            emptyText="No activity yet."
            segments={[
              { label: "Review requests", count: requests ?? 0, color: "var(--chart-1)" },
              { label: "Leads", count: leads ?? 0, color: "var(--chart-3)" },
              { label: "AI conversations", count: conversations ?? 0, color: "var(--chart-2)" },
              { label: "Content pieces", count: contentPieces ?? 0, color: "#EC4899" },
              { label: "Quotes", count: quotes ?? 0, color: "#EA580C" },
              { label: "Automations", count: (automations ?? 0) + (instantReplies ?? 0), color: "var(--chart-4)" },
            ]}
          />
        </div>
      </div>
    </>
  );
}
