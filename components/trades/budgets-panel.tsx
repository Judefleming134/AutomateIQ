"use client";

import { useActionState } from "react";
import { PiggyBank, Trash2 } from "lucide-react";
import { saveBudget, deleteBudget } from "@/app/tradeos/actions";
import { formatEuro } from "@/lib/trades/core";

export type BudgetRow = {
  id: string;
  category: string;
  monthly_limit: number;
  /** This month's spend in the category, computed server-side. */
  spent: number;
};

/**
 * Ramp-style category budgets: a monthly limit per category, tracked against
 * this month's scanned bills, over-budget flagged loudly. Suggested categories
 * come from what's actually been scanned, so setting up takes seconds.
 */
export function BudgetsPanel({
  budgets,
  suggestedCategories,
}: {
  budgets: BudgetRow[];
  suggestedCategories: string[];
}) {
  const [saveState, saveAction, saving] = useActionState(saveBudget, undefined);
  const [delState, delAction] = useActionState(deleteBudget, undefined);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <section className="panel panel-block">
        <h2 className="panel-title">
          <PiggyBank size={16} style={{ verticalAlign: "-3px" }} /> This month against budget
        </h2>
        {budgets.length === 0 ? (
          <p className="empty-state" style={{ margin: 0 }}>
            No budgets yet — set your first one below (materials and fuel are
            the usual starting points).
          </p>
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            {budgets.map((b) => {
              const pct = b.monthly_limit > 0 ? Math.min(100, Math.round((b.spent / b.monthly_limit) * 100)) : 0;
              const over = b.spent > b.monthly_limit;
              return (
                <div key={b.id}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13.5, marginBottom: 4 }}>
                    <span style={{ textTransform: "capitalize", fontWeight: 600 }}>
                      {b.category}
                      {over && (
                        <span className="badge badge-red" style={{ marginLeft: 8 }}>
                          over budget
                        </span>
                      )}
                    </span>
                    <span style={{ fontVariantNumeric: "tabular-nums", color: over ? "var(--red, #f87171)" : "var(--faint)" }}>
                      {formatEuro(b.spent)} / {formatEuro(b.monthly_limit)}
                    </span>
                  </div>
                  <div style={{ height: 8, borderRadius: 4, background: "var(--line, rgba(255,255,255,.08))", overflow: "hidden" }}>
                    <div
                      style={{
                        width: `${pct}%`,
                        height: "100%",
                        borderRadius: 4,
                        background: over
                          ? "var(--red, #f87171)"
                          : pct >= 80
                            ? "var(--orange, #fb923c)"
                            : "var(--green, #34d399)",
                      }}
                    />
                  </div>
                  <form action={delAction} style={{ marginTop: 4 }}>
                    <input type="hidden" name="id" value={b.id} />
                    <button
                      type="submit"
                      className="btn btn-ghost btn-sm"
                      style={{ fontSize: 11.5, padding: "2px 8px" }}
                      aria-label={`Remove ${b.category} budget`}
                    >
                      <Trash2 size={12} /> remove
                    </button>
                  </form>
                </div>
              );
            })}
          </div>
        )}
        {delState?.error && (
          <p style={{ color: "var(--red, #f87171)", fontSize: 13, margin: "10px 0 0" }}>{delState.error}</p>
        )}
      </section>

      <form action={saveAction} className="panel panel-block">
        <h2 className="panel-title">Set a budget</h2>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
          <div>
            <label htmlFor="bud-cat">Category</label>
            <input id="bud-cat" name="category" list="bud-cats" maxLength={60} placeholder="materials" style={{ width: 180 }} />
            <datalist id="bud-cats">
              {suggestedCategories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <div>
            <label htmlFor="bud-lim">Monthly limit (€)</label>
            <input id="bud-lim" name="limit" inputMode="decimal" placeholder="2000" style={{ width: 140 }} />
          </div>
          <button type="submit" className="btn btn-primary btn-sm" disabled={saving} style={{ marginBottom: 8 }}>
            {saving ? "Saving…" : "Save budget"}
          </button>
        </div>
        {saveState?.error && (
          <p style={{ color: "var(--red, #f87171)", fontSize: 13, margin: "8px 0 0" }}>{saveState.error}</p>
        )}
        {saveState?.ok && (
          <p style={{ color: "var(--green, #34d399)", fontSize: 13, margin: "8px 0 0" }}>✓ Budget saved.</p>
        )}
      </form>
    </div>
  );
}
