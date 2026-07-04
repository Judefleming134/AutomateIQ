import Link from "next/link";
import {
  Building2,
  CheckCircle2,
  PauseCircle,
  Plus,
  Send,
} from "lucide-react";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { StatCard } from "@/components/portal/stat-card";
import { RunRemindersButton } from "@/components/admin/run-reminders-button";

const AUDIT_LABELS: Record<string, string> = {
  "customer.create": "Created customer",
  "customer.suspend": "Suspended customer",
  "customer.unsuspend": "Reactivated customer",
  "customer.delete": "Deleted customer",
  "customer.password_reset_sent": "Sent password reset",
  "product.assign": "Assigned product",
  "product.remove": "Removed product",
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
            <h1>Platform overview</h1>
            <p>Signed in as {user.email}</p>
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
          hint="platform-wide"
        />
      </div>

      <div className="grid-2">
        <div className="panel panel-block">
          <h2 className="panel-title">
            Newest customers
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
          <h2 className="panel-title">Recent admin activity</h2>
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
