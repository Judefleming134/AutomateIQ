import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadProspectQueues } from "@/lib/growth/prospect-queue";

/**
 * /growth/prospects did three FULL TABLE READS on every load — every
 * page-turn, every search, every filter change:
 *
 *   1. every prospect's `industry`, to build a <select> of ~32 distinct values
 *   2. every active prospect, to work out which still need researching
 *   3. every row of ge_research, for the same reason
 *
 * ~42,000 rows serialised to JSON over ~20 paged PostgREST requests, reduced
 * in Node to a 32-item dropdown and a 300-row queue. Postgres answers all
 * three in under 10ms — the cost is the transfer and the parse.
 *
 * Migration 0042 adds two views that answer the questions we actually have.
 * The test that matters is that BOTH PATHS AGREE: the fast one is only worth
 * having if it is not a different page.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");

type Row = {
  id: string;
  company: string;
  website: string | null;
  status: string;
  industry: string | null;
  created_at: string;
};

/** A fixture that is deliberately awkward: mixed statuses, blanks, dupes. */
function fixture(): { prospects: Row[]; researched: Set<string> } {
  const statuses = ["new", "contacted", "follow_up_sent", "won", "lost", "archived", "research_failed"];
  const prospects: Row[] = Array.from({ length: 400 }, (_, i) => ({
    id: `p${String(i).padStart(3, "0")}`,
    company: `Company ${i}`,
    website: i % 3 === 0 ? null : `https://co${i}.ie`,
    status: statuses[i % statuses.length],
    industry:
      i % 11 === 0 ? null : i % 13 === 0 ? "   " : `  Industry ${i % 9}  `,
    created_at: new Date(2026, 0, 1, 0, i).toISOString(),
  }));
  const researched = new Set(prospects.filter((_, i) => i % 5 === 0).map((p) => p.id));
  return { prospects, researched };
}

const CLOSED = ["won", "lost", "do_not_contact", "archived"];

/**
 * A fake PostgREST that serves EITHER the views or only the base tables,
 * applying the same filters/ordering PostgREST would.
 */
function fakeDb(opts: { withViews: boolean }) {
  const { prospects, researched } = fixture();
  const requests: string[] = [];

  const unresearched = () =>
    prospects.filter((p) => !CLOSED.includes(p.status) && !researched.has(p.id));

  function builder(table: string) {
    requests.push(table);
    let rows: Record<string, unknown>[] = [];
    let exact = false;

    if (table === "ge_prospect_industries") {
      if (!opts.withViews) {
        return thenable(
          { data: null, error: { code: "PGRST205", message: 'relation "ge_prospect_industries" does not exist' } }
        );
      }
      rows = [
        ...new Set(
          prospects
            .map((p) => (p.industry ?? "").trim())
            .filter(Boolean)
        ),
      ]
        .sort()
        .map((industry) => ({ industry }));
    } else if (table === "ge_unresearched_prospects") {
      if (!opts.withViews) {
        return thenable(
          { data: null, error: { code: "PGRST205", message: 'relation "ge_unresearched_prospects" does not exist' } }
        );
      }
      rows = unresearched().map((p) => ({
        id: p.id,
        company: p.company,
        website: p.website,
        status: p.status,
        has_website: Boolean(p.website && p.website.trim()),
        created_at: p.created_at,
      }));
    } else if (table === "ge_prospects") {
      rows = prospects.map((p) => ({ ...p }));
    } else if (table === "ge_research") {
      rows = [...researched].map((prospect_id) => ({ prospect_id }));
    }

    const chain: Record<string, unknown> = {};
    const self = () => chain;
    let limit: number | null = null;

    Object.assign(chain, {
      select: (_cols: string, o?: { count?: string }) => {
        if (o?.count === "exact") exact = true;
        return chain;
      },
      not: (col: string, op: string, val: unknown) => {
        if (col === "industry" && op === "is") rows = rows.filter((r) => r.industry != null);
        if (col === "status" && op === "in") {
          rows = rows.filter((r) => !CLOSED.includes(String(r.status)));
        }
        return chain;
      },
      neq: (col: string, val: unknown) => {
        rows = rows.filter((r) => r[col] !== val);
        return chain;
      },
      eq: (col: string, val: unknown) => {
        rows = rows.filter((r) => r[col] === val);
        return chain;
      },
      order: (col: string, o?: { ascending?: boolean }) => {
        const asc = o?.ascending !== false;
        rows = rows.slice().sort((a, b) => {
          const x = a[col], y = b[col];
          if (x === y) return 0;
          return (x! < y! ? -1 : 1) * (asc ? 1 : -1);
        });
        return chain;
      },
      limit: (n: number) => {
        limit = n;
        return chain;
      },
      range: (from: number, to: number) => {
        const page = rows.slice(from, to + 1);
        return thenable({ data: page, error: null });
      },
      then: (res: (v: unknown) => unknown) => {
        const out = limit == null ? rows : rows.slice(0, limit);
        return Promise.resolve({
          data: out,
          error: null,
          count: exact ? rows.length : undefined,
        }).then(res);
      },
    });
    return chain as never;
  }

  function thenable(value: unknown) {
    const t: Record<string, unknown> = {};
    const self = () => t;
    Object.assign(t, {
      select: self, not: self, neq: self, eq: self, order: self, limit: self,
      range: () => thenable(value),
      then: (res: (v: unknown) => unknown) => Promise.resolve(value).then(res),
    });
    return t as never;
  }

  return { admin: { from: builder } as never, requests, prospects, researched };
}

describe("the fast path and the old path give the SAME page", () => {
  it("agrees on the industry list", async () => {
    const fast = await loadProspectQueues(fakeDb({ withViews: true }).admin);
    const slow = await loadProspectQueues(fakeDb({ withViews: false }).admin);
    expect(fast.usedViews).toBe(true);
    expect(slow.usedViews).toBe(false);
    expect(fast.industries).toEqual(slow.industries);
    // And it is a real, trimmed, de-duplicated, sorted list.
    expect(fast.industries.length).toBeGreaterThan(1);
    expect(fast.industries).toEqual([...fast.industries].sort());
    expect(fast.industries.every((i) => i === i.trim() && i !== "")).toBe(true);
    expect(new Set(fast.industries).size).toBe(fast.industries.length);
  });

  it("agrees on how many leads still need researching", async () => {
    const fast = await loadProspectQueues(fakeDb({ withViews: true }).admin);
    const slow = await loadProspectQueues(fakeDb({ withViews: false }).admin);
    expect(fast.freshTotal).toBe(slow.freshTotal);
    expect(fast.failedTotal).toBe(slow.failedTotal);
    expect(fast.freshTotal).toBeGreaterThan(0);
    expect(fast.failedTotal).toBeGreaterThan(0);
  });

  it("agrees on WHICH leads, not just how many", async () => {
    const fast = await loadProspectQueues(fakeDb({ withViews: true }).admin);
    const slow = await loadProspectQueues(fakeDb({ withViews: false }).admin);
    expect(new Set(fast.fresh.map((p) => p.id))).toEqual(
      new Set(slow.fresh.map((p) => p.id))
    );
    expect(new Set(fast.failed.map((p) => p.id))).toEqual(
      new Set(slow.failed.map((p) => p.id))
    );
  });

  it("never offers an already-researched lead, on either path", async () => {
    const db = fakeDb({ withViews: true });
    const fast = await loadProspectQueues(db.admin);
    const slow = await loadProspectQueues(fakeDb({ withViews: false }).admin);
    for (const [name, q] of [["fast", fast], ["slow", slow]] as const) {
      for (const p of [...q.fresh, ...q.failed]) {
        expect(db.researched.has(p.id), `${name} offered researched ${p.id}`).toBe(false);
      }
    }
  });

  it("never offers a closed or archived lead, on either path", async () => {
    for (const withViews of [true, false]) {
      const q = await loadProspectQueues(fakeDb({ withViews }).admin);
      for (const p of [...q.fresh, ...q.failed]) {
        expect(["won", "lost", "do_not_contact", "archived"]).not.toContain(p.status);
      }
    }
  });

  it("keeps the fresh queue and the retry group disjoint", async () => {
    for (const withViews of [true, false]) {
      const q = await loadProspectQueues(fakeDb({ withViews }).admin);
      expect(q.fresh.every((p) => p.status !== "research_failed")).toBe(true);
      expect(q.failed.every((p) => p.status === "research_failed")).toBe(true);
    }
  });
});

describe("it reads far less to say the same thing", () => {
  it("touches the views, not the base tables, when they exist", async () => {
    const db = fakeDb({ withViews: true });
    await loadProspectQueues(db.admin);
    expect(db.requests).toContain("ge_prospect_industries");
    expect(db.requests).toContain("ge_unresearched_prospects");
    expect(db.requests).not.toContain("ge_research");
  });

  it("falls back to the base tables when the views are missing", async () => {
    const db = fakeDb({ withViews: false });
    const q = await loadProspectQueues(db.admin);
    expect(q.usedViews).toBe(false);
    expect(db.requests).toContain("ge_prospects");
    expect(db.requests).toContain("ge_research");
    // And the page is still correct, which is the whole point of the fallback.
    expect(q.industries.length).toBeGreaterThan(1);
    expect(q.freshTotal).toBeGreaterThan(0);
  });

  it("bounds what it hands the browser", async () => {
    for (const withViews of [true, false]) {
      const q = await loadProspectQueues(fakeDb({ withViews }).admin);
      expect(q.fresh.length).toBeLessThanOrEqual(300);
      expect(q.failed.length).toBeLessThanOrEqual(60);
      // The TOTAL is still exact even though the batch is capped — that is
      // the number the queue shows, and a capped count would understate it.
      expect(q.freshTotal).toBeGreaterThanOrEqual(q.fresh.length);
    }
  });
});

describe("the migration and the page", () => {
  const MIGRATION = readFileSync(
    path.join(ROOT, "supabase", "migrations", "0042_prospect_views.sql"),
    "utf8"
  );
  const PAGE = readFileSync(
    path.join(ROOT, "app", "growth", "(app)", "prospects", "page.tsx"),
    "utf8"
  );

  it("both views are security_invoker", () => {
    // Without it a view runs with the OWNER's rights and reads straight past
    // the row-level security on ge_prospects for whoever queries it.
    expect((MIGRATION.match(/security_invoker = true/g) ?? []).length).toBe(2);
  });

  it("the views are indexed for the questions they ask", () => {
    expect(MIGRATION).toContain("ge_prospects_industry_idx");
    expect(MIGRATION).toContain("ge_research_prospect_idx");
  });

  it("the unresearched view keeps research_failed, so one read serves both groups", () => {
    expect(MIGRATION).toContain("p.status not in ('won', 'lost', 'do_not_contact', 'archived')");
    // The SQL, not the prose above it — the comment mentions research_failed
    // precisely because the view deliberately includes it.
    const sql = MIGRATION.replace(/--.*$/gm, "");
    const from = sql.indexOf("create or replace view ge_unresearched_prospects");
    // Just the statement — the COMMENT after it mentions research_failed
    // precisely because the view deliberately includes it.
    const where = sql.slice(from, sql.indexOf(";", from));
    expect(where).not.toContain("research_failed");
  });

  it("the page no longer scans the whole table itself", () => {
    expect(PAGE).toContain("loadProspectQueues(admin)");
    expect(PAGE).not.toContain('admin.from("ge_research")');
    expect(PAGE).not.toMatch(/selectAllRows<\{ industry/);
  });
});
