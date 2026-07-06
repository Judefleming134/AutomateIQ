import {
  Send,
  Users,
  MessageSquare,
  Zap,
  MousePointerClick,
  TrendingUp,
  PenLine,
  Calculator,
  Contact,
  Instagram,
  Truck,
  CheckCircle2,
} from "lucide-react";
import type { ReactNode } from "react";
import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";
import { getEnabledProductKeys } from "@/lib/agents/registry";
import { computeAgentUsage } from "@/lib/analytics/usage";
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

  const [usage, enabled, { data: requestRows }, { data: leadRows }, { data: msgRows }] =
    await Promise.all([
      computeAgentUsage(supabase),
      getEnabledProductKeys(supabase),
      supabase.from("ra_review_requests").select("created_at").gte("created_at", since).limit(2000),
      supabase.from("wa_leads").select("created_at").gte("created_at", since).limit(2000),
      supabase.from("aa_messages").select("created_at").gte("created_at", since).limit(2000),
    ]);

  // A card shows when its product is enabled OR there's already data for it —
  // so each business sees exactly the agents that are relevant to them, and a
  // future agent slots in with one more entry here.
  type Card = { key: string; enabled: boolean; count: number; node: ReactNode };
  const has = (k: string) => enabled.has(k);

  const cards: Card[] = [
    {
      key: "review-agent",
      enabled: has("review-agent"),
      count: usage.reviewRequests,
      node: <StatCard label="Review requests" value={usage.reviewRequests} icon={<Send />} accent="#7C3AED" hint="all time" />,
    },
    {
      key: "review-agent-clicks",
      enabled: has("review-agent"),
      count: usage.reviewClicks,
      node: <StatCard label="Review clicks" value={usage.reviewClicks} icon={<MousePointerClick />} accent="#22D3EE" hint={`${usage.reviewConversionPct}% conversion`} />,
    },
    {
      key: "website-agent",
      enabled: has("website-agent"),
      count: usage.leads,
      node: <StatCard label="Website leads" value={usage.leads} icon={<Users />} accent="#0891B2" hint="all time" />,
    },
    {
      key: "ai-assistant",
      enabled: has("ai-assistant"),
      count: usage.aiMessages,
      node: <StatCard label="AI messages" value={usage.aiMessages} icon={<MessageSquare />} accent="#3B82F6" hint={`${usage.aiConversations} conversations`} />,
    },
    {
      key: "content-agent",
      enabled: has("content-agent"),
      count: usage.contentPieces,
      node: <StatCard label="Content written" value={usage.contentPieces} icon={<PenLine />} accent="#EC4899" hint="all time" />,
    },
    {
      key: "instant-quote-agent",
      enabled: has("instant-quote-agent"),
      count: usage.quotes,
      node: <StatCard label="Quotes created" value={usage.quotes} icon={<Calculator />} accent="#EA580C" hint={`${usage.quotesAccepted} accepted`} />,
    },
    {
      key: "crm-agent",
      enabled: has("crm-agent"),
      count: usage.crmContacts,
      node: <StatCard label="CRM contacts" value={usage.crmContacts} icon={<Contact />} accent="#3B82F6" hint="in your pipeline" />,
    },
    {
      key: "speed-to-lead-agent",
      enabled: has("speed-to-lead-agent"),
      count: usage.instantReplies,
      node: <StatCard label="Instant lead replies" value={usage.instantReplies} icon={<Zap />} accent="#F59E0B" hint="under 60s each" />,
    },
    {
      key: "instagram-dm-setter",
      enabled: has("instagram-dm-setter"),
      count: usage.igMessages,
      node: <StatCard label="Instagram DMs" value={usage.igMessages} icon={<Instagram />} accent="#E1306C" hint={`${usage.igConversations} conversations`} />,
    },
    {
      key: "logistics-control-centre",
      enabled: has("logistics-control-centre"),
      count: usage.logDeliveries + usage.logVehicles,
      node: <StatCard label="Deliveries" value={usage.logDeliveries} icon={<Truck />} accent="#FB7185" hint={`${usage.logVehicles} vehicles tracked`} />,
    },
    {
      key: "automations",
      enabled: true,
      count: usage.reminders + usage.instantReplies,
      node: <StatCard label="Automations run" value={usage.reminders + usage.instantReplies} icon={<CheckCircle2 />} accent="#059669" hint="reminders + instant replies" />,
    },
  ];

  const visible = cards.filter((c) => c.enabled || c.count > 0);

  // Donut: only dimensions with data, so the mix always reads cleanly.
  const donutSegments = [
    { label: "Review requests", count: usage.reviewRequests, color: "var(--chart-1)" },
    { label: "Leads", count: usage.leads, color: "var(--chart-3)" },
    { label: "AI conversations", count: usage.aiConversations, color: "var(--chart-2)" },
    { label: "Content pieces", count: usage.contentPieces, color: "#EC4899" },
    { label: "Quotes", count: usage.quotes, color: "#EA580C" },
    { label: "Instagram DMs", count: usage.igMessages, color: "#E1306C" },
    { label: "Deliveries", count: usage.logDeliveries, color: "#FB7185" },
    { label: "Automations", count: usage.reminders + usage.instantReplies, color: "var(--chart-4)" },
  ].filter((s) => s.count > 0);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Analytics</h1>
          <p>
            One view across every agent and system on your account — reviews,
            leads, AI usage, content, quotes, CRM, Instagram, logistics and
            automations. Revenue tracking arrives with billing.
          </p>
        </div>
      </div>

      <div className="stat-grid">
        {visible.map((c) => (
          <div key={c.key}>{c.node}</div>
        ))}
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
            <span><span className="sys-index">04 /</span>Activity mix — all agents</span>
          </h2>
          <DonutChart
            centerLabel="events"
            emptyText="No activity yet."
            segments={donutSegments}
          />
        </div>
      </div>
    </>
  );
}
