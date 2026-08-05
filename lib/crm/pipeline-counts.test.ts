import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * ClientIQ's three headline numbers were `.length` of the list underneath
 * them — and that list is both SEARCH-FILTERED and CAPPED.
 *
 * The page builds one contacts query, applies the search box to it, caps it at
 * 500, and then read the stat cards off the result:
 *
 *     Contacts   = contacts.length
 *     Won        = contacts.filter(stage === "won").length
 *     Open tasks = tasks.length          // that query is .limit(25)
 *
 * So two things went wrong at once, on the screen sold as "every customer and
 * lead from every agent — in one pipeline":
 *
 *   1. TYPING IN THE SEARCH BOX REWROTE THE TOTALS. On the 420-contact
 *      pipeline below, searching "murphy" drops the header to "Contacts 39",
 *      and a search that matches nothing drops it to "Contacts 0 · Won 0".
 *      The whole-business figure silently became a search result — and an
 *      unmatched search looks exactly like a pipeline that has been wiped.
 *   2. THE CAPS FROZE THEM. Past 500 contacts the card reads 500 for ever, and
 *      past 25 open tasks it reads 25 for ever, no matter how many pile up.
 *      "Open tasks / follow-ups to do" is the number you'd act on.
 *
 * Named in CLAUDE.md: "a count that doesn't match what its click-through
 * shows". Here the click-through was the same query, so it never disagreed
 * with itself — it just agreed on the wrong number.
 *
 * The counts are now their own `count: "exact", head: true` queries, run in
 * the SAME Promise.all as the list, so correctness costs no extra latency.
 * Nothing was removed: the pipeline still caps at 500 and the follow-up list
 * still shows 25 — they now say so when the cap actually bites.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const PAGE = readFileSync(
  path.join(ROOT, "app", "portal", "crm-agent", "page.tsx"),
  "utf8"
);

const LIST_CAP = 500;
const TASK_CAP = 25;

type C = { name: string; stage: string };

/** A real-ish pipeline: 420 contacts, 39 of them won, 60 open tasks. */
const pipeline: C[] = Array.from({ length: 420 }, (_, i) => ({
  name: i % 11 === 0 ? `Murphy ${i}` : `Contact ${i}`,
  stage: i % 11 === 0 ? "won" : ["new", "contacted", "qualified", "lost"][i % 4],
}));
const openTasks = Array.from({ length: 60 }, (_, i) => ({ id: `t${i}` }));

/** What the page's own query does with the search box. */
const listed = (q: string) =>
  pipeline
    .filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()))
    .slice(0, LIST_CAP);

describe("the search box used to rewrite the totals", () => {
  it("with no search, old and new agree — which is why it survived", () => {
    const rows = listed("");
    expect(rows.length).toBe(420);
    expect(rows.filter((c) => c.stage === "won").length).toBe(39);
  });

  it("typing a name collapsed the whole-pipeline figure to the match count", () => {
    const rows = listed("murphy");
    const OLD_contacts = rows.length;
    const OLD_won = rows.filter((c) => c.stage === "won").length;

    // 39 Murphys out of 420 contacts. The header said "Contacts 39".
    expect(OLD_contacts).toBe(39);
    expect(OLD_contacts).not.toBe(pipeline.length);

    // NEW: the count query is unfiltered, so it is unaffected by the search.
    const NEW_contacts = pipeline.length;
    const NEW_won = pipeline.filter((c) => c.stage === "won").length;
    expect(NEW_contacts).toBe(420);
    expect(NEW_won).toBe(OLD_won); // this one happened to match; the label didn't
    expect(NEW_won).toBe(39);
  });

  it("a search that matches nothing showed an empty business", () => {
    const rows = listed("zzzz");
    expect(rows.length).toBe(0); // OLD header: "Contacts 0 · Won 0"
    expect(pipeline.length).toBe(420); // NEW header: unchanged
  });
});

describe("the caps froze them", () => {
  it("past 500 contacts the card could never move again", () => {
    const big = Array.from({ length: 640 }, (_, i) => ({ name: `C${i}`, stage: "new" }));
    const OLD = big.slice(0, LIST_CAP).length;
    expect(OLD).toBe(500);
    expect(big.length).toBe(640);
    // Add a hundred more customers, and OLD is still 500.
    const bigger = [...big, ...Array.from({ length: 100 }, (_, i) => ({ name: `D${i}`, stage: "new" }))];
    expect(bigger.slice(0, LIST_CAP).length).toBe(OLD);
    expect(bigger.length).toBe(740);
  });

  it("'Open tasks / follow-ups to do' sat at 25 with 60 outstanding", () => {
    const OLD = openTasks.slice(0, TASK_CAP).length;
    expect(OLD).toBe(25);
    expect(openTasks.length).toBe(60);
    // The number now shown, and the number the list is hiding.
    expect(openTasks.length - OLD).toBe(35);
  });
});

describe("the page asks the database instead of counting the page", () => {
  it("each stat has its own exact count query", () => {
    expect(PAGE).toContain('supabase.from("crm_contacts").select("id", { count: "exact", head: true })');
    expect(PAGE).toMatch(/from\("crm_contacts"\)\s*\.select\("id", \{ count: "exact", head: true \}\)\s*\.eq\("stage", "won"\)/);
    expect(PAGE).toMatch(/from\("crm_tasks"\)\s*\.select\("id", \{ count: "exact", head: true \}\)\s*\.eq\("done", false\)/);
  });

  it("they run in the SAME Promise.all as the list, so nothing got slower", () => {
    const block = PAGE.slice(PAGE.indexOf("] = await Promise.all(["), PAGE.indexOf("const all = contacts ?? []"));
    for (const q of ["crm_contacts", "crm_tasks"]) expect(block, q).toContain(q);
    expect((PAGE.match(/await Promise\.all\(\[/g) ?? [])).toHaveLength(1);
  });

  it("the cards read the counts, not the arrays", () => {
    expect(PAGE).toContain("value={contactCount}");
    expect(PAGE).toContain("value={openTaskCount}");
    expect(PAGE).not.toContain("value={all.length}");
    expect(PAGE).not.toContain("value={openTasks.length}");
  });

  it("a failed count falls back to the list rather than a confident zero", () => {
    // `count` comes back null on error. Showing 0 over a full pipeline is the
    // same lie in the other direction.
    expect(PAGE).toContain("const contactCount = contactTotal ?? all.length;");
    expect(PAGE).toContain("const openTaskCount = openTaskTotal ?? openTasks.length;");
    expect(PAGE).toContain('const won = wonTotal ?? all.filter((c) => c.stage === "won").length;');
  });
});

describe("and it says where the caps bite", () => {
  it("the contacts note only appears when there really are more", () => {
    expect(PAGE).toContain(
      "const contactsTruncated = !query && contactCount > all.length && all.length >= LIST_CAP;"
    );
    expect(PAGE).toContain("most recently active of");
    // Not while searching — a search showing fewer rows than the total is
    // expected, and a note there would be noise.
    expect(PAGE).toContain("!query &&");
  });

  it("the follow-up note names the number being hidden", () => {
    expect(PAGE).toContain("const tasksHidden = Math.max(0, openTaskCount - openTasks.length);");
    expect(PAGE).toContain("more open task");
  });

  it("the search card says how many matched, so the box still gives feedback", () => {
    // The match count didn't disappear — it moved to where it belongs.
    expect(PAGE).toContain("matching");
    expect(PAGE).toContain("query ? `${all.length} matching");
  });
});

describe("nothing was taken away", () => {
  it("the cap and the search are both still there", () => {
    expect(PAGE).toContain("const LIST_CAP = 500;");
    expect(PAGE).toContain(".limit(LIST_CAP)");
    expect(PAGE).toContain(".limit(25)");
    expect(PAGE).toContain('name.ilike.%${query}%,email.ilike.%${query}%,company.ilike.%${query}%');
  });

  it("every stage still renders, and the empty states are untouched", () => {
    expect(PAGE).toContain('const STAGE_ORDER = ["new", "contacted", "qualified", "won", "lost"] as const;');
    expect(PAGE).toContain("No contacts match that search.");
    expect(PAGE).toContain("No contacts yet — click");
    expect(PAGE).toContain("No open tasks.");
  });
});
