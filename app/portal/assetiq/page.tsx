import { Wrench, AlertTriangle, CalendarClock, Euro } from "lucide-react";
import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";
import { StatCard } from "@/components/portal/stat-card";
import { ActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/admin/submit-button";
import { isMissingTableError } from "@/lib/db/errors";
import { dublinDate } from "@/lib/growth/dates";
import {
  summariseDue,
  daysUntil,
  euroFromCents,
  SOON_DAYS,
} from "@/lib/assetiq/due";
import { addAsset } from "./actions";
import { StatusSelect, DueEditor } from "./interactive";

export const metadata = { title: "AssetIQ — AutomateIQ" };

type AssetRow = {
  id: string;
  name: string;
  category: string;
  identifier: string | null;
  assigned_to: string | null;
  location: string | null;
  status: string;
  purchase_date: string | null;
  purchase_cost_cents: number | null;
  next_due_date: string | null;
  next_due_label: string | null;
  notes: string | null;
};

const CATEGORY_LABEL: Record<string, string> = {
  vehicle: "Vehicle",
  plant: "Plant",
  tool: "Tool",
  equipment: "Equipment",
  it: "IT",
  other: "Other",
};

const STATUS_LABEL: Record<string, string> = {
  in_service: "In service",
  in_repair: "In repair",
  retired: "Retired",
};

/** "3 days ago" / "in 12 days" / "today" — a number nobody has to subtract. */
function whenLabel(due: string, today: string): string {
  const n = daysUntil(due, today);
  if (n === 0) return "today";
  if (n < 0) return `${-n} day${n === -1 ? "" : "s"} ago`;
  return `in ${n} day${n === 1 ? "" : "s"}`;
}

export default async function AssetIqPage() {
  const { profile } = await requireSession();
  const supabase = await createClient();

  // One read, one pass. Every number on this page and every row under it comes
  // from THIS array — see lib/assetiq/due.ts for why that matters.
  const { data, error } = await supabase
    .from("ast_assets")
    .select(
      "id, name, category, identifier, assigned_to, location, status, purchase_date, purchase_cost_cents, next_due_date, next_due_label, notes"
    )
    .order("created_at", { ascending: false })
    .limit(1000);

  const migrationMissing = isMissingTableError(error);
  const assets = (data ?? []) as AssetRow[];
  const today = dublinDate();
  const { overdue, soon, overdueCount, soonCount } = summariseDue(assets, today);

  const live = assets.filter((a) => a.status !== "retired");
  const bookValue = live.reduce((sum, a) => sum + (a.purchase_cost_cents ?? 0), 0);
  const costed = live.filter((a) => a.purchase_cost_cents !== null).length;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">
            <Wrench size={20} /> AssetIQ
          </h1>
          <p className="page-sub">
            Every van, tool and machine you own — what it cost, who has it, and
            what&apos;s due on it before it goes past.
          </p>
        </div>
      </div>

      {migrationMissing && (
        <div
          className="panel panel-block"
          style={{ borderLeft: "3px solid var(--amber, #f59e0b)" }}
        >
          <strong>Almost ready.</strong> The AssetIQ table isn&apos;t in the
          database yet — run <code>supabase/migrations/0045_assetiq.sql</code> in
          the Supabase SQL editor and this page comes to life.
        </div>
      )}

      <div className="stat-grid">
        <StatCard
          label="Overdue"
          value={overdueCount}
          icon={<AlertTriangle />}
          accent="#f87171"
          hint={overdueCount === 0 ? "nothing has gone past" : "needs doing now"}
        />
        <StatCard
          label={`Due in ${SOON_DAYS} days`}
          value={soonCount}
          icon={<CalendarClock />}
          accent="#f59e0b"
          hint="book these before they bite"
        />
        <StatCard
          label="Assets in service"
          value={live.length}
          icon={<Wrench />}
          accent="#22D3EE"
          hint={
            assets.length === live.length
              ? "none retired"
              : `${assets.length - live.length} retired`
          }
        />
        <StatCard
          label="What it cost"
          value={bookValue > 0 ? euroFromCents(bookValue)! : "—"}
          icon={<Euro />}
          accent="#34D399"
          // The honest version of a "total value" tile: it is the purchase
          // price of the assets that HAVE one, not a valuation, and it says how
          // many that is. A total that quietly counts 4 of 19 assets is the
          // "count that doesn't match its click-through" bug wearing a suit.
          hint={
            costed === 0
              ? "no purchase prices entered yet"
              : `purchase price of ${costed} of ${live.length}`
          }
        />
      </div>

      <div className="grid-2" style={{ gap: 18, alignItems: "start" }}>
        <div>
          <h2 className="section-title">Due and overdue</h2>
          {overdue.length === 0 && soon.length === 0 ? (
            <div className="panel panel-block">
              <p style={{ margin: 0, fontSize: 13.5 }}>
                {assets.length === 0
                  ? "Nothing here yet. Add your first van or machine on the right — a name is the only thing required."
                  : `Nothing due in the next ${SOON_DAYS} days. Set a due date on an asset below and it shows up here.`}
              </p>
            </div>
          ) : (
            <div className="panel panel-block" style={{ display: "grid", gap: 10 }}>
              {[...overdue, ...soon].map((a) => {
                const isOverdue = a.next_due_date! < today;
                return (
                  <div
                    key={a.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 10,
                      flexWrap: "wrap",
                      borderLeft: `3px solid ${isOverdue ? "#f87171" : "#f59e0b"}`,
                      paddingLeft: 10,
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <strong style={{ fontSize: 13.5 }}>{a.name}</strong>
                      {a.identifier && (
                        <span style={{ fontSize: 12, color: "var(--faint)" }}>
                          {" "}
                          · {a.identifier}
                        </span>
                      )}
                      <div style={{ fontSize: 12.5, color: "var(--body)" }}>
                        {a.next_due_label ?? "Due"} · {a.next_due_date} (
                        {whenLabel(a.next_due_date!, today)})
                      </div>
                    </div>
                    <DueEditor
                      id={a.id}
                      dueDate={a.next_due_date}
                      dueLabel={a.next_due_label}
                    />
                  </div>
                );
              })}
            </div>
          )}

          <h2 className="section-title" style={{ marginTop: 22 }}>
            Everything you own
          </h2>
          {assets.length === 0 ? (
            <div className="panel panel-block">
              <p style={{ margin: 0, fontSize: 13.5 }}>
                {migrationMissing
                  ? "Nothing to show until the database is updated."
                  : "No assets yet."}
              </p>
            </div>
          ) : (
            <div className="panel panel-block" style={{ display: "grid", gap: 12 }}>
              {assets.map((a) => (
                <div
                  key={a.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: 10,
                    flexWrap: "wrap",
                    opacity: a.status === "retired" ? 0.55 : 1,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <strong style={{ fontSize: 13.5 }}>{a.name}</strong>{" "}
                    <span className="badge badge-gray" style={{ fontSize: 10.5 }}>
                      {CATEGORY_LABEL[a.category] ?? a.category}
                    </span>
                    <div style={{ fontSize: 12.5, color: "var(--faint)" }}>
                      {[
                        a.identifier,
                        a.assigned_to,
                        a.location,
                        euroFromCents(a.purchase_cost_cents),
                        a.next_due_date
                          ? `${a.next_due_label ?? "due"} ${a.next_due_date}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || STATUS_LABEL[a.status]}
                    </div>
                    {a.notes && (
                      <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 2 }}>
                        {a.notes}
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <StatusSelect id={a.id} status={a.status} />
                    <DueEditor
                      id={a.id}
                      dueDate={a.next_due_date}
                      dueLabel={a.next_due_label}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <h2 className="section-title">Add an asset</h2>
          {/* One required field. Everything a small business does not know off
              the top of its head — cost, purchase date, what's due — can be
              filled in later, because a form that demands all of it is a form
              nobody finishes and an asset register nobody has. */}
          <ActionForm action={addAsset} className="panel panel-block" style={{ display: "grid", gap: 10 }}>
            <div>
              <label htmlFor="as-name">Name</label>
              <input id="as-name" name="name" required maxLength={160} placeholder="Transit 191-D-1234" />
            </div>

            <div>
              <label htmlFor="as-category">Category</label>
              <select id="as-category" name="category" defaultValue="other">
                {Object.entries(CATEGORY_LABEL).map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="as-identifier">Reg / serial (optional)</label>
              <input id="as-identifier" name="identifier" maxLength={120} />
            </div>

            <div>
              <label htmlFor="as-assigned">Who has it (optional)</label>
              <input id="as-assigned" name="assigned_to" maxLength={160} placeholder="Ciaran's van" />
            </div>

            <div>
              <label htmlFor="as-location">Where it lives (optional)</label>
              <input id="as-location" name="location" maxLength={160} placeholder="Yard, container 2" />
            </div>

            <div>
              <label htmlFor="as-cost">What it cost (optional)</label>
              <input id="as-cost" name="purchase_cost" maxLength={20} placeholder="4200" inputMode="decimal" />
            </div>

            <div>
              <label htmlFor="as-bought">Bought (optional)</label>
              <input id="as-bought" name="purchase_date" type="date" />
            </div>

            <div>
              <label htmlFor="as-due">Next due (optional)</label>
              <input id="as-due" name="next_due_date" type="date" />
              <input
                name="next_due_label"
                maxLength={80}
                placeholder="CVRT, service, PAT test…"
                style={{ marginTop: 6 }}
              />
              <p style={{ fontSize: 12, color: "var(--faint)", margin: "4px 0 0" }}>
                This is the one that earns its keep — anything with a date shows
                up above before it goes past.
              </p>
            </div>

            <div>
              <label htmlFor="as-notes">Notes (optional)</label>
              <input id="as-notes" name="notes" maxLength={2000} />
            </div>

            <SubmitButton pendingText="Adding…">Add asset</SubmitButton>
          </ActionForm>
        </div>
      </div>
    </div>
  );
}
