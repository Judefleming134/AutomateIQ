import { requireTradesAccount } from "@/lib/trades/data";
import { BudgetsPanel, type BudgetRow } from "@/components/trades/budgets-panel";

export const metadata = { title: "Budgets · FinanceIQ" };

export default async function BudgetsPage() {
  const { supabase } = await requireTradesAccount("/finance/login");
  const today = new Date();
  const monthStart = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}-01`;

  const [{ data: budgets }, { data: monthBills }, { data: allCats }] = await Promise.all([
    supabase
      .from("trades_budgets")
      .select("id, category, monthly_limit")
      .order("category"),
    supabase
      .from("trades_expenses")
      .select("category, total")
      .eq("direction", "payable")
      .gte("issued_at", monthStart)
      .limit(500),
    supabase
      .from("trades_expenses")
      .select("category")
      .eq("direction", "payable")
      .not("category", "is", null)
      .limit(500),
  ]);

  // This month's spend per (lower-cased) category.
  const spent = new Map<string, number>();
  for (const b of monthBills ?? []) {
    const cat = (b.category ?? "uncategorised").trim().toLowerCase();
    spent.set(cat, (spent.get(cat) ?? 0) + Number(b.total));
  }

  const rows: BudgetRow[] = (budgets ?? []).map((b) => ({
    id: b.id,
    category: b.category,
    monthly_limit: Number(b.monthly_limit),
    spent: Math.round((spent.get(b.category) ?? 0) * 100) / 100,
  }));

  const suggested = [
    ...new Set(
      (allCats ?? [])
        .map((c) => (c.category as string).trim().toLowerCase())
        .filter((c) => c && !rows.some((r) => r.category === c))
    ),
  ].slice(0, 12);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Budgets</h1>
          <p>
            A monthly limit per category, tracked against your scanned bills —
            over-budget gets flagged before it gets away from you.
          </p>
        </div>
      </div>
      <BudgetsPanel budgets={rows} suggestedCategories={suggested} />
      <p style={{ fontSize: 12, color: "var(--faint)", marginTop: 14 }}>
        <span className="badge badge-gray">Budget alerts by email — not available yet</span>{" "}
        <span className="badge badge-gray">Per-person spend controls — not available yet</span>
      </p>
    </>
  );
}
