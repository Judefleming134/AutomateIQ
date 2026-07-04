import Link from "next/link";
import { Lock, Send, MousePointerClick, TrendingUp } from "lucide-react";
import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";
import { PRODUCT_REGISTRY } from "@/lib/products/registry";
import { ProductIcon } from "@/lib/products/icons";
import { StatCard } from "@/components/portal/stat-card";
import { StatusBadge } from "@/components/portal/status-badge";

export default async function PortalHome() {
  const { profile } = await requireSession();
  const supabase = await createClient();

  const [{ data: business }, { data: enabledRows }] = await Promise.all([
    supabase
      .from("businesses")
      .select("name, google_review_link")
      .eq("id", profile.business_id)
      .single(),
    // RLS already scopes this to the caller's own business — no need to
    // filter by business_id again here.
    supabase.from("business_products").select("products(key)"),
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

  if (hasReviewAgent) {
    const [sentRes, clickedRes, recentRes] = await Promise.all([
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
    ]);
    totalSent = sentRes.count ?? 0;
    totalClicked = clickedRes.count ?? 0;
    recent = recentRes.data ?? [];
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
        <div className="page-hero-row">
          <div>
            <p className="page-hero-date">{today}</p>
            <h1>Welcome back, {business?.name ?? "there"}</h1>
            <p>Here&apos;s what&apos;s happening with your AutomateIQ platform today.</p>
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

      {hasReviewAgent && (
        <div className="stat-grid">
          <StatCard
            label="Review requests sent"
            value={totalSent}
            icon={<Send />}
            accent="#7C3AED"
          />
          <StatCard
            label="Review link clicks"
            value={totalClicked}
            icon={<MousePointerClick />}
            accent="#22D3EE"
          />
          <StatCard
            label="Click rate"
            value={clickRate}
            icon={<TrendingUp />}
            accent="#34D399"
          />
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

      {hasReviewAgent && (
        <div className="panel panel-block">
          <h2 className="panel-title">
            Recent activity
            <Link href="/portal/review-agent/history">View all →</Link>
          </h2>
          {recent.length === 0 ? (
            <p className="empty-state">
              No activity yet — send your first review request to get started.
            </p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Status</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((r) => {
                    const customer = r.ra_customers as { name: string } | null;
                    return (
                      <tr key={r.id}>
                        <td>{customer?.name ?? "unknown"}</td>
                        <td>
                          <StatusBadge status={r.status} />
                        </td>
                        <td>{new Date(r.created_at).toLocaleString()}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}
