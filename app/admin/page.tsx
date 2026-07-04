import Link from "next/link";
import {
  Building2,
  CheckCircle2,
  PauseCircle,
  Plus,
  Send,
  Users,
  MessageSquare,
  MousePointerClick,
  Boxes,
} from "lucide-react";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { getLocalWeather, greetingForNow } from "@/lib/weather";
import { StatCard } from "@/components/portal/stat-card";
import { RunRemindersButton } from "@/components/admin/run-reminders-button";
import { HudCorners } from "@/components/shell/hud-corners";
import {
  ActivityBarChart,
  DonutChart,
  bucketByDay,
} from "@/components/portal/activity-chart";

const AUDIT_LABELS: Record<string, string> = {
  "customer.create": "Created customer",
  "customer.suspend": "Suspended customer",
  "customer.unsuspend": "Reactivated customer",
  "customer.delete": "Deleted customer",
  "customer.password_reset_sent": "Sent password reset",
  "product.assign": "Assigned product",
  "product.remove": "Removed product",
  "module.create": "Created custom module",
  "module.delete": "Deleted custom module",
  "document.upload": "Uploaded document",
  "document.delete": "Deleted document",
};

export default async function AdminHome() {
  const user = await requireAdmin();
  const supabase = createAdminClient();

  const [
    { count: total },
    { count: active },
    { count: suspended },
    { count: requestsSent },
    { data: recentBusinesses },
    { data: recentAudit },
  ] = await Promise.all([
    supabase
      .from("businesses")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null),
    supabase
      .from("businesses")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null)
      .eq("status", "active"),
    supabase
      .from("businesses")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null)
      .eq("status", "suspended"),
    supabase
      .from("ra_review_requests")
      .select("id", { count: "exact", head: true })
      .in("status", ["sent", "reminded", "clicked"]),
    supabase
      .from("businesses")
      .select("id, name, status, created_at")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("admin_audit_log")
      .select("id, action, created_at, metadata")
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  const since30 = new Date(Date.now() - 29 * 86_400_000).toISOString();
  const since14 = new Date(Date.now() - 13 * 86_400_000).toISOString();
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const sinceToday = dayStart.toISOString();

  const [
    weather,
    { data: newBusinesses },
    { data: newRequests },
    { count: clicked },
    { count: totalLeads },
    { count: totalConversations },
    { count: requestsToday },
    { count: leadsToday },
    { count: aiMessagesToday },
    { data: adoptionRows },
  ] = await Promise.all([
    getLocalWeather(),
    supabase
      .from("businesses")
      .select("created_at")
      .gte("created_at", since30)
      .limit(1000),
    supabase
      .from("ra_review_requests")
      .select("created_at")
      .gte("created_at", since14)
      .limit(2000),
    supabase
      .from("ra_review_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "clicked"),
    supabase.from("wa_leads").select("id", { count: "exact", head: true }),
    supabase
      .from("aa_conversations")
      .select("id", { count: "exact", head: true }),
    supabase
      .from("ra_review_requests")
      .select("id", { count: "exact", head: true })
      .gte("created_at", sinceToday),
    supabase
      .from("wa_leads")
      .select("id", { count: "exact", head: true })
      .gte("created_at", sinceToday),
    supabase
      .from("aa_messages")
      .select("id", { count: "exact", head: true })
      .gte("created_at", sinceToday),
    supabase.from("business_products").select("products(name)"),
  ]);

  // Product adoption — businesses per product, counted from the join table.
  const adoption = new Map<string, number>();
  for (const row of adoptionRows ?? []) {
    const name = (row.products as unknown as { name: string } | null)?.name;
    if (name) adoption.set(name, (adoption.get(name) ?? 0) + 1);
  }
  const adoptionList = [...adoption.entries()].sort((a, b) => b[1] - a[1]);
  const maxAdoption = Math.max(1, ...adoptionList.map(([, n]) => n));

  const clickRate =
    (requestsSent ?? 0) > 0
      ? `${Math.round(((clicked ?? 0) / (requestsSent ?? 1)) * 100)}%`
      : "—";

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
            <h1>{greetingForNow()} — platform overview</h1>
            <p>
              Today: {requestsToday ?? 0} review request{(requestsToday ?? 0) === 1 ? "" : "s"} ·{" "}
              {leadsToday ?? 0} lead{(leadsToday ?? 0) === 1 ? "" : "s"} ·{" "}
              {aiMessagesToday ?? 0} AI message{(aiMessagesToday ?? 0) === 1 ? "" : "s"} —
              signed in as {user.email}
            </p>
          </div>
          <Link href="/admin/customers" className="btn btn-primary">
            <Plus size={15} /> New customer
          </Link>
        </div>
      </section>

      <div className="panel panel-block" style={{ marginBottom: 28 }}>
        <h2 className="panel-title" style={{ marginBottom: 10 }}>
          Daily tasks
        </h2>
        <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--body)" }}>
          Review-request reminders send automatically every morning. Use this
          to run them right now instead of waiting — safe to press any number
          of times, each reminder can only ever send once.
        </p>
        <RunRemindersButton />
      </div>

      <div className="stat-grid">
        <StatCard
          label="Total customers"
          value={total ?? 0}
          icon={<Building2 />}
          accent="#3B82F6"
        />
        <StatCard
          label="Active"
          value={active ?? 0}
          icon={<CheckCircle2 />}
          accent="#34D399"
        />
        <StatCard
          label="Suspended"
          value={suspended ?? 0}
          icon={<PauseCircle />}
          accent="#FB923C"
        />
        <StatCard
          label="Review requests sent"
          value={requestsSent ?? 0}
          icon={<Send />}
          accent="#7C3AED"
          hint={`${clickRate} click rate`}
        />
        <StatCard
          label="Review clicks"
          value={clicked ?? 0}
          icon={<MousePointerClick />}
          accent="#22D3EE"
          hint="platform-wide"
        />
        <StatCard
          label="Website leads"
          value={totalLeads ?? 0}
          icon={<Users />}
          accent="#0891B2"
          hint="platform-wide"
        />
        <StatCard
          label="AI conversations"
          value={totalConversations ?? 0}
          icon={<MessageSquare />}
          accent="#3B82F6"
          hint="platform-wide"
        />
      </div>

      <div className="grid-2">
        <div className="panel panel-block">
          <h2 className="panel-title">
            <span>
              <span className="sys-index">01 /</span>
              New customers — last 30 days
            </span>
          </h2>
          <ActivityBarChart
            buckets={bucketByDay(
              (newBusinesses ?? []).map((b) => b.created_at),
              30
            )}
            accent="var(--chart-2)"
            unit="customers"
          />
        </div>

        <div className="panel panel-block">
          <h2 className="panel-title">
            <span>
              <span className="sys-index">02 /</span>
              Review requests — last 14 days
            </span>
          </h2>
          <ActivityBarChart
            buckets={bucketByDay(
              (newRequests ?? []).map((r) => r.created_at),
              14
            )}
            accent="var(--chart-1)"
          />
        </div>
      </div>

      <div className="grid-2">
        <div className="panel panel-block">
          <h2 className="panel-title">
            <span>
              <span className="sys-index">03 /</span>
              Product adoption
            </span>
            <Link href="/admin/modules">Modules →</Link>
          </h2>
          {adoptionList.length === 0 ? (
            <p className="empty-state">No products assigned yet.</p>
          ) : (
            <ul className="adoption-list">
              {adoptionList.map(([name, n]) => (
                <li key={name}>
                  <span className="adoption-label">
                    <Boxes size={13} /> {name}
                  </span>
                  <span className="adoption-bar">
                    <span style={{ width: `${Math.round((n / maxAdoption) * 100)}%` }} />
                  </span>
                  <span className="adoption-count">{n}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="panel panel-block">
          <h2 className="panel-title">
            <span>
              <span className="sys-index">04 /</span>
              Platform engagement
            </span>
          </h2>
          <DonutChart
            centerLabel="events"
            emptyText="No activity yet."
            segments={[
              { label: "Review requests", count: requestsSent ?? 0, color: "var(--chart-1)" },
              { label: "Leads", count: totalLeads ?? 0, color: "var(--chart-3)" },
              { label: "AI conversations", count: totalConversations ?? 0, color: "var(--chart-2)" },
            ]}
          />
        </div>
      </div>

      <div className="grid-2">
        <div className="panel panel-block">
          <h2 className="panel-title">
            <span>
              <span className="sys-index">05 /</span>
              Newest customers
            </span>
            <Link href="/admin/customers">View all →</Link>
          </h2>
          {(recentBusinesses ?? []).length === 0 ? (
            <p className="empty-state">No customers yet.</p>
          ) : (
            <ul className="feed-list">
              {(recentBusinesses ?? []).map((b) => (
                <li key={b.id}>
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      minWidth: 0,
                    }}
                  >
                    <span
                      className={`badge ${b.status === "active" ? "badge-green" : "badge-orange"}`}
                    >
                      {b.status}
                    </span>
                    <Link
                      href={`/admin/customers/${b.id}`}
                      style={{
                        color: "var(--heading)",
                        fontWeight: 600,
                        textDecoration: "none",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {b.name}
                    </Link>
                  </span>
                  <span className="feed-time">
                    {new Date(b.created_at).toLocaleDateString("en-IE", {
                      day: "numeric",
                      month: "short",
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="panel panel-block">
          <h2 className="panel-title">
            <span>
              <span className="sys-index">06 /</span>
              Recent admin activity
            </span>
          </h2>
          {(recentAudit ?? []).length === 0 ? (
            <p className="empty-state">Nothing logged yet.</p>
          ) : (
            <ul className="feed-list">
              {(recentAudit ?? []).map((entry) => {
                const meta = entry.metadata as {
                  businessName?: string;
                  email?: string;
                } | null;
                const detail = meta?.businessName || meta?.email || "";
                return (
                  <li key={entry.id}>
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {AUDIT_LABELS[entry.action] ?? entry.action}
                      {detail && (
                        <span style={{ color: "var(--faint)" }}> — {detail}</span>
                      )}
                    </span>
                    <span className="feed-time">
                      {new Date(entry.created_at).toLocaleDateString("en-IE", {
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
    </>
  );
}
