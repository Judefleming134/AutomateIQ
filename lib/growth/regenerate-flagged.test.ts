import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * "Fix N flagged drafts automatically" reported success for work it hadn't done.
 *
 * A FLAGGED draft is one carrying a placeholder, an invented contact name, or
 * another company's details — `draftLooksBroken`. Those are held at send time by
 * the review gates rather than sent, so the button that rewrites them is the
 * thing standing between Jude and outreach silently not going out.
 *
 * It returned `{ ok: true }` whenever no draft came back STILL broken. Three
 * different ways of doing nothing satisfied that:
 *
 *     what happened                      fixed   failures   returned    UI said
 *     ────────────────────────────────   ─────   ────────   ─────────   ────────────────
 *     all 12 rewritten and saved            12          0   ok          All rewritten  ✓
 *     every UPDATE failed at the DB         12          0   ok          All rewritten  ✗
 *     every id skipped by the guard          0          0   ok          All rewritten  ✗
 *     9 saved, 3 sent since page load        9          0   ok          All rewritten  ✗
 *
 * Row 2: the update's error was discarded outright and `fixed += 1` ran anyway.
 * Rows 3–4: the shape guard `continue`d without touching either counter, so an
 * id the 07:00 run had already sent between the page rendering and the button
 * being pressed vanished from the arithmetic entirely.
 *
 * The single-draft twin — runJarvisAction's `regenerate_email` — already had the
 * check, with the reason written on it: "a silent DB failure must never be
 * reported back to Jude as '✓ done' (he'd trust it and move on)." The bulk path,
 * which does up to 12 at a time, was the one without it.
 *
 * The cost is quiet and expensive: press Fix, be told it's fixed, and find the
 * same drafts held again at 07:00 with nothing on screen explaining why the
 * outreach didn't go.
 *
 * Named in CLAUDE.md: "reporting success for work that didn't happen — a
 * swallowed failure counted as a completed check".
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SRC = readFileSync(
  path.join(ROOT, "app", "growth", "(app)", "jarvis", "actions.ts"),
  "utf8"
);
const FN = SRC.slice(
  SRC.indexOf("export async function regenerateFlaggedDrafts"),
  SRC.indexOf("export async function autopilotAction")
);
/** Comments stripped — the file explains at length what it used to do. */
const CODE = FN.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
/** The single-draft twin, which had the check all along. */
const TWIN = SRC.slice(
  SRC.indexOf('case "regenerate_email"'),
  SRC.indexOf('case "queue_email"')
);

type Draft = {
  id: string;
  company: string;
  /** false when the 07:00 run sent it (or it otherwise left draft/queued/failed). */
  rewritable: boolean;
  /** the AI came back with something still broken */
  stillBroken?: boolean;
  /** the UPDATE fails at the database */
  saveFails?: boolean;
};

type Result = { ok?: boolean; error?: string };

/** A replay of the shipped loop, so the table above can be asserted. */
function run(drafts: Draft[]): Result & { fixed: number; skipped: number } {
  let fixed = 0;
  let skipped = 0;
  const failures: string[] = [];
  for (const d of drafts) {
    if (!d.rewritable) {
      skipped += 1;
      continue;
    }
    if (d.stillBroken) {
      failures.push(`${d.company}: rewrite still broken — do this one in the Studio`);
      continue;
    }
    if (d.saveFails) {
      failures.push(`${d.company}: the rewrite didn't save (timeout)`);
      continue;
    }
    fixed += 1;
  }
  if (fixed === drafts.length) return { ok: true, fixed, skipped };
  const parts = [`Rewrote ${fixed}/${drafts.length}.`];
  if (skipped > 0) parts.push(`${skipped} no longer a rewritable draft`);
  if (failures.length > 0) parts.push(`Still needs you: ${failures.join("; ")}`);
  return { error: parts.join(" "), fixed, skipped };
}

/** What the OLD loop returned, for the same input. */
function oldRun(drafts: Draft[]): Result {
  let fixed = 0;
  const failures: string[] = [];
  for (const d of drafts) {
    if (!d.rewritable) continue;
    if (d.stillBroken) {
      failures.push(`${d.company}: still broken`);
      continue;
    }
    fixed += 1; // saveFails was invisible here
  }
  if (failures.length > 0) return { error: `Rewrote ${fixed}/${drafts.length}.` };
  return { ok: true };
}

const draft = (id: string, over: Partial<Draft> = {}): Draft => ({
  id,
  company: `Co ${id}`,
  rewritable: true,
  ...over,
});
const twelve = (over: Partial<Draft> = {}) =>
  Array.from({ length: 12 }, (_, i) => draft(String(i), over));

/** The green "✓ All rewritten under the new rules" only shows on `ok`. */
const claimsAllRewritten = (r: Result) => r.ok === true;

describe("the four rows of the table", () => {
  it("all rewritten and saved — still the green tick", () => {
    const r = run(twelve());
    expect(r.fixed).toBe(12);
    expect(claimsAllRewritten(r)).toBe(true);
    // Unchanged from before: the working path must not have moved.
    expect(claimsAllRewritten(oldRun(twelve()))).toBe(true);
  });

  it("every UPDATE fails — was 'All rewritten', now says nothing saved", () => {
    const drafts = twelve({ saveFails: true });
    expect(claimsAllRewritten(oldRun(drafts))).toBe(true); // the bug
    const r = run(drafts);
    expect(claimsAllRewritten(r)).toBe(false);
    expect(r.fixed).toBe(0);
    expect(r.error).toContain("Rewrote 0/12");
    expect(r.error).toContain("didn't save");
  });

  it("every id skipped by the guard — was 'All rewritten', now says so", () => {
    const drafts = twelve({ rewritable: false });
    expect(claimsAllRewritten(oldRun(drafts))).toBe(true); // the bug
    const r = run(drafts);
    expect(claimsAllRewritten(r)).toBe(false);
    expect(r.skipped).toBe(12);
    expect(r.error).toContain("Rewrote 0/12");
    expect(r.error).toContain("no longer a rewritable draft");
  });

  it("the 07:00 run sent 3 mid-session — was 'All rewritten', now 9/12", () => {
    // The realistic one: this panel is open while the morning send fires.
    const drafts = [
      ...Array.from({ length: 9 }, (_, i) => draft(`ok${i}`)),
      ...Array.from({ length: 3 }, (_, i) => draft(`sent${i}`, { rewritable: false })),
    ];
    expect(claimsAllRewritten(oldRun(drafts))).toBe(true); // the bug
    const r = run(drafts);
    expect(claimsAllRewritten(r)).toBe(false);
    expect(r.fixed).toBe(9);
    expect(r.skipped).toBe(3);
    expect(r.error).toContain("Rewrote 9/12");
  });
});

describe("every id asked for is accounted for exactly once", () => {
  it("fixed + skipped + failures always equals the number submitted", () => {
    const mixes: Draft[][] = [
      twelve(),
      twelve({ saveFails: true }),
      twelve({ rewritable: false }),
      twelve({ stillBroken: true }),
      [
        draft("a"),
        draft("b", { rewritable: false }),
        draft("c", { stillBroken: true }),
        draft("d", { saveFails: true }),
      ],
      [draft("solo", { saveFails: true })],
    ];
    for (const drafts of mixes) {
      const r = run(drafts);
      const failed =
        drafts.filter((d) => d.rewritable && (d.stillBroken || d.saveFails)).length;
      expect(r.fixed + r.skipped + failed, JSON.stringify(drafts)).toBe(drafts.length);
    }
  });

  it("the green tick appears if and only if every id was really rewritten", () => {
    const mixes: Draft[][] = [
      twelve(),
      twelve({ saveFails: true }),
      twelve({ rewritable: false }),
      twelve({ stillBroken: true }),
      [draft("a"), draft("b", { rewritable: false })],
      [draft("a"), draft("b", { saveFails: true })],
      [draft("a"), draft("b")],
    ];
    for (const drafts of mixes) {
      const r = run(drafts);
      const allReal = drafts.every((d) => d.rewritable && !d.stillBroken && !d.saveFails);
      expect(claimsAllRewritten(r), JSON.stringify(drafts)).toBe(allReal);
    }
  });

  it("a still-broken draft was already reported, and still is", () => {
    // The one case the old code got right — it must not regress.
    const drafts = [draft("a"), draft("b", { stillBroken: true })];
    expect(claimsAllRewritten(oldRun(drafts))).toBe(false);
    expect(claimsAllRewritten(run(drafts))).toBe(false);
    expect(run(drafts).error).toContain("Still needs you");
  });
});

describe("the action matches the replay", () => {
  it("captures the update's error instead of discarding it", () => {
    expect(CODE).toContain("const { error: saveErr } = await admin");
    expect(CODE).toContain("if (saveErr)");
    expect(CODE).toContain("didn't save");
  });

  it("no longer increments the counter regardless of the write", () => {
    // The exact shape of the bug: an unchecked update immediately followed by
    // the success counter.
    expect(CODE).not.toMatch(/\.eq\("id", id\);\s*fixed \+= 1;/);
  });

  it("counts the ids the guard skips", () => {
    expect(CODE).toContain("skipped += 1");
    expect(CODE).toContain("let skipped = 0");
    // The counter has to be inside the guard, before the continue.
    const guard = CODE.slice(CODE.indexOf('!["draft", "queued", "failed"]'));
    expect(guard.indexOf("skipped += 1")).toBeLessThan(guard.indexOf("continue;"));
  });

  it("returns ok only when every id submitted was rewritten", () => {
    expect(CODE).toContain("if (fixed === ids.length) return { ok: true };");
  });

  it("the partial message names all three numbers", () => {
    expect(CODE).toContain("Rewrote ${fixed}/${ids.length}");
    expect(CODE).toContain("${skipped}");
    expect(CODE).toContain("failures.join");
  });

  it("this is the check the single-draft twin already had", () => {
    expect(TWIN).toContain("const { error: rewriteErr }");
    expect(TWIN).toContain("if (rewriteErr)");
  });
});

describe("nothing about the working path changed", () => {
  it("still bounded to 12 per press", () => {
    expect(CODE).toContain(".slice(0, 12)");
  });

  it("still refuses an empty submission", () => {
    expect(CODE).toContain('return { error: "No flagged drafts to regenerate." }');
  });

  it("still only touches outbound email drafts", () => {
    expect(CODE).toContain('msg.direction !== "outbound"');
    expect(CODE).toContain('msg.channel !== "email"');
    expect(CODE).toContain('!["draft", "queued", "failed"].includes(msg.status)');
  });

  it("still preserves the draft's purpose rather than rewriting it cold", () => {
    expect(CODE).toContain("PURPOSES.includes(msg.purpose as MessagePurpose)");
  });

  it("still runs the safety gates on the rewrite before saving it", () => {
    // sanitizeOutreachBody + draftLooksBroken are inviolable — CLAUDE.md.
    expect(CODE).toContain("sanitizeOutreachBody(res.body)");
    expect(CODE).toContain("draftLooksBroken(clean)");
    // Anchored on the UPDATE itself, not on saveErr — otherwise removing the
    // error capture would fail this test too, for the wrong reason.
    const save = CODE.indexOf("subject: res.subject");
    expect(save).toBeGreaterThan(-1);
    expect(CODE.indexOf("draftLooksBroken(clean)")).toBeLessThan(save);
  });

  it("still lifts a failed draft back to draft, and never touches a queued one", () => {
    expect(CODE).toContain('...(msg.status === "failed" ? { status: "draft" } : {})');
  });

  it("still refreshes both surfaces that render these drafts", () => {
    expect(CODE).toContain('revalidatePath("/growth/jarvis")');
    expect(CODE).toContain('revalidatePath("/growth/inbox")');
  });
});
