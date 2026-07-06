import Link from "next/link";
import { Layers, Rocket, Lock, Sparkles } from "lucide-react";
import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";
import { getEnabledProductKeys } from "@/lib/agents/registry";
import { isMissingTableError } from "@/lib/db/errors";
import { SystemIcon } from "@/lib/systems/icons";
import { getSystemByKey } from "@/lib/systems/catalog";

/**
 * Business Systems that are live and reachable in the portal map to their
 * entitlement product + route. When the product is enabled the Solutions card
 * becomes a real Launch link into the running system.
 */
const SYSTEM_LAUNCH: Record<string, { productKey: string; route: string }> = {
  "ai-logistics-control-centre": {
    productKey: "logistics-control-centre",
    route: "/portal/logistics",
  },
};

const DEV_STATUS: Record<string, string> = {
  planned: "Planned",
  in_development: "In development",
  available: "Available",
};
const MODULE_STATUS: Record<string, { label: string; cls: string }> = {
  coming_soon: { label: "Coming soon", cls: "badge-gray" },
  provisioning: { label: "Provisioning", cls: "badge-blue" },
  active: { label: "Active", cls: "badge-green" },
  disabled: { label: "Disabled", cls: "badge-gray" },
};

export default async function SolutionsPage() {
  const { profile } = await requireSession();
  const supabase = await createClient();

  const [{ data: business }, { data: systems, error: systemsError }, { data: assignments }, enabledKeys] =
    await Promise.all([
      supabase.from("businesses").select("name").eq("id", profile.business_id!).maybeSingle(),
      supabase
        .from("bsys_systems")
        .select("id, key, name, description, icon, dev_status, sort_order")
        .order("sort_order", { ascending: true }),
      supabase.from("bsys_assignments").select("system_id, module_status, notes"),
      getEnabledProductKeys(supabase),
    ]);

  const needsMigration = systemsError && isMissingTableError(systemsError);
  const businessName = business?.name ?? "your organisation";
  const assignmentBySystem = new Map(
    (assignments ?? []).map((a) => [a.system_id, a])
  );

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Solutions</h1>
          <p>
            Bespoke enterprise systems, built around {businessName}. Each one plugs into your
            platform as a module — sharing your AI Assistant, data, organisation and branding. This
            is the foundation your future systems slot into.
          </p>
        </div>
      </div>

      {needsMigration ? (
        <div className="panel panel-block">
          <p className="empty-state">
            Database update required — run <code>supabase/manual_update_0012.sql</code> in the
            Supabase SQL Editor, then refresh this page.
          </p>
        </div>
      ) : (
        <>
          <div className="panel panel-block" style={{ marginBottom: 22 }}>
            <p className="empty-state" style={{ margin: 0, textAlign: "left" }}>
              <Sparkles size={14} style={{ verticalAlign: "-2px", marginRight: 8, color: "var(--ac2)" }} />
              These are the systems AutomateIQ can design and build for you. When one is
              commissioned for {businessName}, it activates here as a full module — dedicated
              dashboard, navigation, AI specialist, documentation, reports and analytics — without
              any new logins or infrastructure.
            </p>
          </div>

          <div className="sol-grid">
            {(systems ?? []).map((s) => {
              const meta = getSystemByKey(s.key);
              const accent = meta?.accent ?? "#3B82F6";
              const assignment = assignmentBySystem.get(s.id);
              // A system is live for this business when its entitlement product
              // is enabled (the real gate), or an admin set its module active.
              const launch = SYSTEM_LAUNCH[s.key];
              const productLive = launch ? enabledKeys.has(launch.productKey) : false;
              const moduleStatus = productLive ? "active" : assignment?.module_status ?? "coming_soon";
              const status = MODULE_STATUS[moduleStatus] ?? MODULE_STATUS.coming_soon;
              const launchable = moduleStatus === "active" && Boolean(launch);
              return (
                <div
                  key={s.id}
                  className={`sol-card panel ${launchable ? "" : "is-locked"}`}
                  style={{ "--sys-accent": accent } as React.CSSProperties}
                >
                  <div className="sol-card-head">
                    <span className="sol-card-icon"><SystemIcon name={s.icon ?? "layers"} size={22} /></span>
                    {!launchable && (
                      <span className="badge badge-gray sol-soon"><Lock size={10} /> Coming soon</span>
                    )}
                  </div>
                  <h3>{s.name}</h3>
                  <p className="sol-card-desc">{s.description || meta?.tagline}</p>

                  <dl className="sol-meta">
                    <div>
                      <dt>Development</dt>
                      <dd>{DEV_STATUS[s.dev_status] ?? s.dev_status}</dd>
                    </div>
                    <div>
                      <dt>Organisation</dt>
                      <dd>{assignment ? businessName : "Not assigned"}</dd>
                    </div>
                    <div>
                      <dt>Module</dt>
                      <dd><span className={`badge ${status.cls}`}>{status.label}</span></dd>
                    </div>
                  </dl>

                  {launchable && launch ? (
                    <Link href={launch.route} className="btn btn-primary btn-sm sol-launch">
                      <Rocket size={13} /> Launch
                    </Link>
                  ) : (
                    <button type="button" className="btn btn-secondary btn-sm sol-launch" disabled>
                      Launch
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
