import Link from "next/link";
import {
  Lock,
  Send,
  MousePointerClick,
  Sparkles,
  Users,
  MessageSquare,
  Zap,
  Globe,
  LifeBuoy,
  Bell,
} from "lucide-react";
import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";
import { getLocalWeather, greetingForNow } from "@/lib/weather";
import { PRODUCT_REGISTRY } from "@/lib/products/registry";
import { ProductIcon } from "@/lib/products/icons";
import { StatCard } from "@/components/portal/stat-card";
import { StatusBadge } from "@/components/portal/status-badge";
import { HudCorners } from "@/components/shell/hud-corners";
import {
  ActivityBarChart,
  bucketByDay,
} from "@/components/portal/activity-chart";

export default async function PortalHome() {
  const { profile } = await requireSession();
  const supabase = await createClient();

  const [{ data: business }, { data: enabledRows }, weather] =
    await Promise.all([
      supabase
        .from("businesses")
        .select("name, google_review_link")
        .eq("id", profile.business_id)
        .single(),
      // RLS already scopes this to the caller's own business — no need to
      // filter by business_id again here.
      supabase.from("business_products").select("products(key)"),
      getLocalWeather(),
    ]);

  const enabledKeys = new Set(
    (enabledRows ?? [])
      .map((r) => (r.products as unknown as { key: string } | null)?.key)
      .filter((k): k is string => Boolean(k))
  );

  const hasReviewAgent = enabledKeys.has("review-agent");

  // Review Agent snapshot for the dashboard — only queried when the
  // product is actually enabled for this business (RLS-scoped).
  let totalSent = 0;
  let totalClicked = 0;
  let recent: {
    id: string;
    status: string;
    created_at: string;
    ra_customers: unknown;
  }[] = [];

  const hasWebsiteAgent = enabledKeys.has("website-agent");
  const hasAssistant = enabledKeys.has("ai-assistant");

  // Cross-module KPIs — every count is a real RLS-scoped query; modules
  // that aren't enabled (or whose tables aren't migrated yet) read 0.
  const [{ count: leadCount }, { count: conversationCount }, { count: automationCount }, { data: assistant }] =
    await Promise.all([
      supabase.from("wa_leads").select("id", { count: "exact", head: true }),
      supabase
        .from("aa_conversations")
        .select("id", { count: "exact", head: true }),
      supabase
        .from("ra_review_requests")
        .select("id", { count: "exact", head: true })
        .not("reminder_sent_at", "is", null),
      supabase
        .from("aa_assistants")
        .select("knowledge")
        .eq("business_id", profile.business_id!)
        .maybeSingle(),
    ]);

  let chartTimestamps: string[] = [];

  if (hasReviewAgent) {
    const chartSince = new Date(Date.now() - 13 * 86_400_000).toISOString();
    const [sentRes, clickedRes, recentRes, chartRes] = await Promise.all([
      supabase
        .from("ra_review_requests")
        .select("id", { count: "exact", head: true })
        .in("status", ["sent", "reminded", "clicked"]),
      supabase
        .from("ra_review_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "clicked"),
      supabase
        .from("ra_review_requests")
        .select("id, status, created_at, ra_customers(name)")
        .order("created_at", { ascending: false })
        .limit(5),
      supabase
        .from("ra_review_requests")
        .select("created_at")
        .gte("created_at", chartSince)
        .limit(1000),
    ]);
    totalSent = sentRes.count ?? 0;
    totalClicked = clickedRes.count ?? 0;
    recent = recentRes.data ?? [];
    chartTimestamps = (chartRes.data ?? []).map((r) => r.created_at);
  }

  const clickRate =
    totalSent > 0 ? `${Math.round((totalClicked / totalSent) * 100)}%` : "—";

  const today = new Date().toLocaleDateString("en-IE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <>
      <section className="page-hero">
        <HudCorners />
        <div className="page-hero-row">
          <div>
            <p className="page-hero-date">
              {today}
              {weather &&
                ` · ${weather.emoji} ${weather.tempC}°C ${weather.label} in ${weather.city}`}
            </p>
            <h1>
              {greetingForNow()}, {business?.name ?? "there"}
            </h1>
            <p>Here&apos;s what&apos;s happening with your AutomateIQ platform today.</p>
            <p style={{ marginTop: 10 }}>
              <span
                className={`badge ${hasAssistant ? (assistant?.knowledge ? "badge-green" : "badge-orange") : "badge-gray"}`}
              >
                <Sparkles size={11} />
                AI Assistant:{" "}
                {hasAssistant
                  ? assistant?.knowledge
                    ? "online"
                    : "needs setup"
                  : "not enabled"}
              </span>
            </p>
          </div>
          {hasReviewAgent && (
            <Link href="/portal/review-agent/send" className="btn btn-primary">
              <Send size={15} /> Send review request
            </Link>
          )}
        </div>
      </section>

      {hasReviewAgent && !business?.google_review_link && (
        <Link
          href="/portal/review-agent/settings"
          className="panel panel-block"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 26,
            textDecoration: "none",
            borderColor: "rgba(251, 146, 60, 0.35)",
          }}
        >
          <span
            style={{
              flex: "none",
              width: 36,
              height: 36,
              borderRadius: 10,
              display: "grid",
              placeItems: "center",
              background: "rgba(251, 146, 60, 0.14)",
              color: "var(--orange)",
              fontSize: 17,
            }}
          >
            !
          </span>
          <span>
            <strong style={{ color: "var(--heading)", display: "block", fontSize: 14 }}>
              Finish setup — add your Google review link
            </strong>
            <span style={{ fontSize: 12.5, color: "var(--body)" }}>
              It takes 30 seconds, and it&apos;s all you need before sending
              your first review request →
            </span>
          </span>
        </Link>
      )}

      {/* Quick actions — every button is a real destination */}
      <div className="quick-actions">
        <Link
          href="/portal/ai-assistant"
          className={`qa-btn${hasAssistant ? "" : " is-disabled"}`}
        >
          <Sparkles size={16} /> Ask AI Assistant
        </Link>
        <Link
          href="/portal/review-agent/send"
          className={`qa-btn${hasReviewAgent ? "" : " is-disabled"}`}
        >
          <Send size={16} /> Send Review Request
        </Link>
        <Link
          href="/portal/website-agent"
          className={`qa-btn${hasWebsiteAgent ? "" : " is-disabled"}`}
        >
          <Globe size={16} /> Manage Website
        </Link>
        <Link
          href="/portal/website-agent/leads"
          className={`qa-btn${hasWebsiteAgent ? "" : " is-disabled"}`}
        >
          <Users size={16} /> View Leads
        </Link>
        <a href="mailto:hello@automateiq.ie" className="qa-btn">
          <LifeBuoy size={16} /> Contact Support
        </a>
      </div>

      <div className="stat-grid">
        <StatCard
          label="Leads"
          value={leadCount ?? 0}
          icon={<Users />}
          accent="#0891B2"
          hint="all time"
        />
        <StatCard
          label="Review requests"
          value={totalSent}
          icon={<Send />}
          accent="#7C3AED"
          hint="all time"
        />
        <StatCard
          label="Review link clicks"
          value={totalClicked}
          icon={<MousePointerClick />}
          accent="#22D3EE"
          hint={`${clickRate} click rate`}
        />
        <StatCard
          label="AI conversations"
          value={conversationCount ?? 0}
          icon={<MessageSquare />}
          accent="#3B82F6"
        />
        <StatCard
          label="Automations completed"
          value={automationCount ?? 0}
          icon={<Zap />}
          accent="#059669"
          hint="auto follow-ups"
        />
      </div>

      {/* Notifications — derived from real state, each links to its fix */}
      {(() => {
        const notes: { text: string; href: string }[] = [];
        if (hasAssistant && !assistant?.knowledge) {
          notes.push({
            text: "Teach your AI Assistant about your business — add knowledge",
            href: "/portal/ai-assistant",
          });
        }
        if (hasReviewAgent && business?.google_review_link) {
          // Pending follow-ups note comes from the stat we already show;
          // only surface the setup-critical items here.
        }
        if (notes.length === 0) return null;
        return (
          <div className="panel panel-block" style={{ marginBottom: 26 }}>
            <h2 className="panel-title">
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <Bell size={15} /> Notifications
              </span>
            </h2>
            <ul className="feed-list">
              {notes.map((n) => (
                <li key={n.text}>
                  <Link
                    href={n.href}
                    style={{ color: "var(--heading)", textDecoration: "none" }}
                  >
                    {n.text} →
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        );
      })()}

      {hasReviewAgent && (
        <div className="grid-main-side">
          <div className="panel panel-block">
            <h2 className="panel-title">
              <span>
                <span className="sys-index">01 /</span>
                Review requests — last 14 days
              </span>
              <Link href="/portal/review-agent">Open Review Agent →</Link>
            </h2>
            <ActivityBarChart
              buckets={bucketByDay(chartTimestamps, 14)}
              accent="var(--chart-1)"
            />
          </div>

          <div className="panel panel-block">
            <h2 className="panel-title">
              <span>
                <span className="sys-index">02 /</span>
                Recent activity
              </span>
              <Link href="/portal/review-agent/history">View all →</Link>
            </h2>
            {recent.length === 0 ? (
              <p className="empty-state">
                No activity yet — send your first review request.
              </p>
            ) : (
              <ul className="feed-list">
                {recent.map((r) => {
                  const customer = r.ra_customers as { name: string } | null;
                  return (
                    <li key={r.id}>
                      <span
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          minWidth: 0,
                        }}
                      >
                        <StatusBadge status={r.status} />
                        <span
                          style={{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {customer?.name ?? "unknown"}
                        </span>
                      </span>
                      <span className="feed-time">
                        {new Date(r.created_at).toLocaleDateString("en-IE", {
                          day: "numeric",
                          month: "short",
                        })}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      <h2 className="section-title">Your products</h2>
      <div className="product-grid" style={{ marginBottom: 28 }}>
        {PRODUCT_REGISTRY.map((product) => {
          const isEnabled = enabledKeys.has(product.key);
          const style = { "--tile-accent": product.accent } as React.CSSProperties;

          const tile = (
            <>
              <div className="product-tile-icon">
                <ProductIcon name={product.iconName} size={21} />
              </div>
              <h3>{product.name}</h3>
              <p>{product.description}</p>
              {isEnabled ? (
                <span className="badge badge-green">Active</span>
              ) : product.status === "coming_soon" ? (
                <span className="badge badge-gray">
                  <Lock size={11} /> Coming soon
                </span>
              ) : (
                <span className="badge badge-gray">
                  <Lock size={11} /> Not enabled
                </span>
              )}
            </>
          );

          return isEnabled ? (
            <Link
              key={product.key}
              href={product.href}
              className="product-tile panel"
              style={style}
            >
              {tile}
            </Link>
          ) : (
            <div
              key={product.key}
              className="product-tile panel is-disabled"
              style={style}
            >
              {tile}
            </div>
          );
        })}
      </div>

    </>
  );
}
