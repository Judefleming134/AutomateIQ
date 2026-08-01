import Link from "next/link";
import { CheckCircle2, XCircle, AlertTriangle, ShieldCheck } from "lucide-react";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkProductReadiness } from "@/lib/admin/product-readiness";

export const metadata = { title: "Product readiness · AutomateIQ admin" };

// Live probe of the real database — never a cached answer. A stale "all ready"
// is worse than no page at all.
export const dynamic = "force-dynamic";

/**
 * Can I sell this today?
 *
 * Every product's tables live in a manual_update_*.sql file that has to be
 * pasted into the SQL Editor by hand, and nothing in the app knew whether that
 * had been done. So the answer was: sell it, and find out when the customer
 * logs in and the software fails in front of them.
 *
 * This asks the database instead. Eleven head-only counts, no rows returned.
 */
export default async function ProductReadinessPage() {
  await requireAdmin();
  const report = await checkProductReadiness(createAdminClient());

  const tone = report.allReady
    ? { bg: "var(--green, #34d399)", label: "Everything is sellable" }
    : report.missing > 0
      ? { bg: "var(--orange, #fb923c)", label: `${report.missing} product${report.missing === 1 ? "" : "s"} would break for a customer today` }
      : { bg: "var(--orange, #fb923c)", label: `${report.errored} product${report.errored === 1 ? "" : "s"} could not be checked` };

  return (
    <div>
      <h1 className="page-title">
        <ShieldCheck size={20} /> Product readiness
      </h1>
      <p className="page-sub">
        Checked live, just now. A product is <strong>ready</strong> when its
        table exists — which is what decides whether a customer who buys it hits
        a working screen or a wall on their first login.
      </p>

      <div
        className="panel panel-block"
        style={{ borderLeft: `3px solid ${tone.bg}`, marginBottom: 16 }}
      >
        <p style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{tone.label}</p>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--faint)" }}>
          {report.ready} of {report.results.length} ready
          {report.missing > 0 && ` · ${report.missing} not set up`}
          {report.errored > 0 && ` · ${report.errored} unreadable`}
        </p>
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        {report.results.map((r) => {
          const icon =
            r.state === "ready" ? (
              <CheckCircle2 size={16} color="var(--green, #34d399)" />
            ) : r.state === "missing" ? (
              <XCircle size={16} color="var(--orange, #fb923c)" />
            ) : (
              <AlertTriangle size={16} color="var(--orange, #fb923c)" />
            );
          return (
            <div
              key={r.key}
              className="panel panel-block"
              style={{
                display: "flex",
                gap: 12,
                alignItems: "center",
                flexWrap: "wrap",
                opacity: r.state === "ready" ? 0.75 : 1,
              }}
            >
              {icon}
              <strong style={{ minWidth: 180 }}>{r.name}</strong>
              <code style={{ fontSize: 12, color: "var(--faint)" }}>{r.table}</code>
              {r.state === "ready" ? (
                <span style={{ marginLeft: "auto", fontSize: 12.5, color: "var(--faint)" }}>
                  Ready to sell
                </span>
              ) : r.state === "missing" ? (
                <span style={{ marginLeft: "auto", fontSize: 12.5 }}>
                  Not set up — run{" "}
                  <code style={{ color: "var(--orange, #fb923c)" }}>{r.migration}</code>{" "}
                  in the Supabase SQL Editor
                </span>
              ) : (
                <span style={{ marginLeft: "auto", fontSize: 12.5 }}>
                  Could not check — {r.detail}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <p style={{ fontSize: 12, color: "var(--faint)", marginTop: 16 }}>
        A customer who opens a product that isn&apos;t set up sees a plain
        &ldquo;still setting up, nothing you did&rdquo; message — never the
        filename above. The filename is logged for you instead.{" "}
        <Link href="/admin">Back to admin</Link>
      </p>
    </div>
  );
}
