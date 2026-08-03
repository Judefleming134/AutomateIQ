import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The guard on bulk delete failed OPEN.
 *
 * Bulk delete looks up which of the ticked prospects are live deals (replied,
 * qualified, meeting booked, won…) so it can skip them. Its own comment says it
 * exists to stop "destroying the record of a paying customer", and cites
 * CLAUDE.md's "destructive overwrite with no undo".
 *
 * It read `{ data: liveRows }` and threw the error away:
 *
 *     const live = liveRows ?? [];
 *     const deletable = ids.filter((id) => !liveIds.has(id));
 *     await admin.from("ge_prospects").delete().in("id", deletable);
 *
 * So ANY failure of that lookup — a network blip, a statement timeout, an
 * over-long request URL from a big selection — produced an EMPTY live list.
 * `deletable` then became every ticked id INCLUDING the won customers, the
 * delete went ahead, the FK cascade took their research, messages, activities,
 * tasks and meetings, and the action returned ok.
 *
 * A guard on an irreversible action has to fail CLOSED. The archive branch
 * immediately below it already did this properly — filters in SQL, checks its
 * error — so the safer of the two operations was the better guarded one.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const ACTIONS = readFileSync(
  path.join(ROOT, "app", "growth", "(app)", "prospects", "actions.ts"),
  "utf8"
);
const DELETE_BRANCH = ACTIONS.slice(
  ACTIONS.indexOf('if (member.role !== "owner") return { error: "Only owners can delete prospects." };'),
  ACTIONS.indexOf('} else if (intent === "archive")')
);

/** The decision, transcribed. */
const deletable = (
  ids: string[],
  lookup: { live: string[] } | { failed: true }
): { deleted: string[]; refused: boolean } => {
  if ("failed" in lookup) return { deleted: [], refused: true };
  const live = new Set(lookup.live);
  return { deleted: ids.filter((id) => !live.has(id)), refused: false };
};

/** What it used to do: a failed lookup read as "nothing is live". */
const before = (ids: string[], lookup: { live: string[] } | { failed: true }) =>
  "failed" in lookup ? ids : ids.filter((id) => !new Set(lookup.live).has(id));

describe("a failed live-deal lookup no longer deletes the live deals", () => {
  const ids = ["won-customer", "dead-lead-1", "dead-lead-2"];

  it("used to delete EVERYTHING when the lookup failed", () => {
    expect(before(ids, { failed: true })).toEqual(ids);
    expect(before(ids, { failed: true })).toContain("won-customer");
  });

  it("now deletes NOTHING and says why", () => {
    const r = deletable(ids, { failed: true });
    expect(r.deleted).toEqual([]);
    expect(r.refused).toBe(true);
  });

  it("the working path is unchanged — live kept, dead deleted", () => {
    const r = deletable(ids, { live: ["won-customer"] });
    expect(r.deleted).toEqual(["dead-lead-1", "dead-lead-2"]);
    expect(r.refused).toBe(false);
    // And identical to the old behaviour when nothing failed.
    expect(r.deleted).toEqual(before(ids, { live: ["won-customer"] }));
  });

  it("deleting only dead leads still works with no live deals at all", () => {
    expect(deletable(ids, { live: [] }).deleted).toEqual(ids);
  });
});

describe("the action now fails closed", () => {
  it("captures the lookup error instead of discarding it", () => {
    expect(DELETE_BRANCH).toContain("error: liveError");
    expect(DELETE_BRANCH).toContain("if (liveError)");
  });

  it("returns before deleting anything", () => {
    // The refusal must come first, or it is a message attached to a delete
    // that already happened.
    expect(DELETE_BRANCH.indexOf("if (liveError)")).toBeLessThan(
      DELETE_BRANCH.indexOf(".delete()")
    );
  });

  it("says nothing was deleted, and why that is the safe answer", () => {
    expect(DELETE_BRANCH).toContain("nothing was deleted");
    expect(DELETE_BRANCH).toContain("could");
    expect(DELETE_BRANCH).toContain("remove a won customer");
  });

  it("no longer swallows the lookup with a bare `?? []`", () => {
    const code = DELETE_BRANCH.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    // The pattern is still present (live = liveRows ?? []) but it can only be
    // reached AFTER the error check above it.
    expect(code.indexOf("liveError")).toBeLessThan(code.indexOf("liveRows ?? []"));
  });
});

describe("and the database enforces it too", () => {
  it("the delete itself excludes live deals in SQL", () => {
    // Belt and braces, and the same clause the archive branch uses. Closes the
    // window between the lookup and the delete: a status that changes in
    // between is caught by the database rather than slipping through.
    expect(DELETE_BRANCH).toContain('.not("status", "in", liveDealFilter)');
  });

  it("which is exactly what archive already did", () => {
    const archive = ACTIONS.slice(
      ACTIONS.indexOf('} else if (intent === "archive")'),
      ACTIONS.indexOf('return { error: "Unknown action." };')
    );
    expect(archive).toContain('.not("status", "in", liveDealFilter)');
    expect(archive).toContain("if (error) return { error: error.message };");
  });

  it("the live-deal set still covers every stage worth protecting", () => {
    for (const status of ["replied", "qualified", "meeting_booked", "won"]) {
      expect(ACTIONS).toContain(`"${status}"`);
    }
  });
});

describe("nothing else about bulk delete moved", () => {
  it("still owners-only", () => {
    expect(DELETE_BRANCH).toContain('Only owners can delete prospects.');
  });

  it("still names the kept deals in the result", () => {
    expect(DELETE_BRANCH).toContain("kept ${live.length} live deal");
    expect(DELETE_BRANCH).toContain("delete them one at a time from their own page");
  });

  it("still refreshes every prospect surface afterwards", () => {
    expect(DELETE_BRANCH).toContain("revalidateProspectSurfaces()");
  });

  it("the single-prospect delete is untouched, so it stays possible", () => {
    expect(ACTIONS).toContain("export async function deleteProspect");
  });
});

describe("the DM drafts query is chunked", () => {
  it("uses the house chunker rather than a raw .in()", () => {
    const DMS = readFileSync(
      path.join(ROOT, "app", "growth", "(app)", "dms", "page.tsx"),
      "utf8"
    );
    expect(DMS).toContain("selectAllRowsByIds<MessageRow>(ids, (chunk)");
    expect(DMS).toContain('.in("prospect_id", chunk)');
    const code = DMS.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toContain('.in("prospect_id", ids)');
  });

  it("because selectAllRows throws rather than truncating", () => {
    // Which is why an over-long URL here 500s the whole page instead of
    // quietly returning fewer drafts.
    const DB = readFileSync(path.join(ROOT, "lib", "growth", "db.ts"), "utf8");
    expect(DB).toContain("throw new Error(");
    expect(DB).toContain("selectAllRows: page at offset");
  });
});
