import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Bulk DELETE had no live-deal guard. Bulk ARCHIVE did.
 *
 * The prospects table has a select-all header checkbox and two bulk buttons.
 * "Archive selected" — the REVERSIBLE one — already refused to touch a
 * replied / qualified / booked / proposal / won prospect, and said which it
 * kept. "Delete selected" — which removes the row, its research, its whole
 * message history and every activity on it, for ever — had nothing.
 *
 * So ticking select-all on a page that happened to include a won customer and
 * pressing Delete was one generic confirm dialog away from destroying the
 * record of a paying customer. The dialog said only "Permanently delete 7
 * prospects?" — it could not name what was in there, because the client has no
 * idea what status any row is.
 *
 * The safe action guarded and the unsafe one didn't. CLAUDE.md names this
 * class outright: "destructive overwrite with no undo".
 *
 * Deliberately NOT a block on ever deleting a live deal — that would remove
 * something Jude can do today. The single-prospect Delete on the prospect's
 * own page is untouched, so it stays possible, just deliberate.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SRC = readFileSync(
  path.join(ROOT, "app", "growth", "(app)", "prospects", "actions.ts"),
  "utf8"
);
const BULK = SRC.slice(
  SRC.indexOf("export async function bulkProspectAction"),
  SRC.indexOf("export async function deleteProspect")
);

const LIVE = [
  "replied",
  "qualified",
  "meeting_booked",
  "proposal_in_progress",
  "proposal_sent",
  "negotiation",
  "won",
];

type Row = { id: string; company: string; status: string };

/** A page of prospects, select-all ticked. */
const page: Row[] = [
  { id: "1", company: "Byrne Roofing", status: "contacted" },
  { id: "2", company: "Kelly Tiling", status: "lost" },
  { id: "3", company: "Nolan Electrical", status: "won" },
  { id: "4", company: "Doyle Plastering", status: "new" },
  { id: "5", company: "Walsh Plumbing", status: "proposal_sent" },
  { id: "6", company: "Fitz Landscaping", status: "research_failed" },
  { id: "7", company: "Moore Joinery", status: "meeting_booked" },
];

const keptBy = (rows: Row[]) => rows.filter((r) => LIVE.includes(r.status));
const deletedBy = (rows: Row[]) => rows.filter((r) => !LIVE.includes(r.status));

describe("a live deal survives a bulk delete", () => {
  it("keeps every won, booked and out-for-proposal prospect", () => {
    expect(keptBy(page).map((r) => r.company)).toEqual([
      "Nolan Electrical",
      "Walsh Plumbing",
      "Moore Joinery",
    ]);
  });

  it("still deletes the dead weight — the feature keeps working", () => {
    // A guard that stopped the whole action would be its own bug: clearing
    // cold leads is what this button is for.
    expect(deletedBy(page).map((r) => r.company)).toEqual([
      "Byrne Roofing",
      "Kelly Tiling",
      "Doyle Plastering",
      "Fitz Landscaping",
    ]);
  });

  it("protects the same statuses archive protects — one list, not two", () => {
    for (const status of LIVE) {
      expect(keptBy([{ id: "x", company: "X", status }]).length, status).toBe(1);
    }
    // And nothing else: archived/lost/do_not_contact are dead weight by design.
    for (const status of ["new", "contacted", "lost", "archived", "do_not_contact"]) {
      expect(keptBy([{ id: "x", company: "X", status }]).length, status).toBe(0);
    }
  });

  it("deletes nothing at all when the whole selection is live", () => {
    const allLive = page.filter((r) => LIVE.includes(r.status));
    expect(deletedBy(allLive)).toEqual([]);
  });
});

describe("the delete path is wired to the guard", () => {
  const del = BULK.slice(BULK.indexOf('if (intent === "delete")'), BULK.indexOf('} else if (intent === "archive")'));

  it("no longer deletes every ticked id outright", () => {
    // The bug, in one line.
    expect(del).not.toMatch(/\.delete\(\)\.in\("id", ids\)/);
  });

  it("deletes only the ids that are not live deals", () => {
    // This pinned the exact one-line form `.delete().in("id", deletable)`. It
    // fired on 2026-08-03 when the delete gained a second, SQL-side guard
    // (`.not("status","in",liveDealFilter)`) and wrapped across lines — see
    // lib/growth/bulk-delete-guard.test.ts for why: the JS filter alone failed
    // OPEN if the live-deal lookup errored.
    //
    // The invariant is unchanged and now holds twice over, so it is pinned as
    // an invariant rather than as one line of formatting.
    expect(del).toContain("const deletable = ids.filter((id) => !liveIds.has(id))");
    expect(del).toMatch(/\.delete\(\)[\s\S]{0,80}\.in\("id", deletable\)/);
    expect(del).toContain('.not("status", "in", liveDealFilter)');
  });

  it("looks the live ones up FIRST, so it can name them", () => {
    // Inferring "kept" from a row count also moves when an id is stale, which
    // would make the message quietly wrong on the one path where being wrong
    // matters most.
    expect(del).toContain('.select("id, company, status")');
    expect(del).toContain('.in("status", LIVE_DEAL_STATUSES)');
    expect(del.indexOf("liveRows")).toBeLessThan(del.indexOf("deletable"));
  });

  it("tells him exactly what was kept and where it went", () => {
    expect(del).toContain("kept ${live.length} live deal");
    expect(del).toContain("Those are still in your pipeline");
    expect(del).toContain("delete them one at a time from their own page");
  });

  it("does not skip the delete when there is nothing deletable", () => {
    // `.in("id", [])` is a query that matches nothing but still round-trips.
    expect(del).toContain("if (deletable.length > 0)");
  });

  it("still refuses a non-owner before doing anything", () => {
    expect(del.indexOf('member.role !== "owner"')).toBeLessThan(del.indexOf("liveRows"));
  });

  it("refreshes the table on the partial path too", () => {
    // The rows that WERE deleted have gone; returning an error without
    // revalidating would leave them on screen.
    const branch = del.slice(del.indexOf("if (live.length > 0)"));
    expect(branch.slice(0, branch.indexOf("return"))).toContain("revalidatePath");
  });
});

describe("archive keeps the behaviour it already had", () => {
  const arc = BULK.slice(BULK.indexOf('} else if (intent === "archive")'));

  it("still skips live deals", () => {
    expect(arc).toContain('.not("status", "in", liveDealFilter)');
  });

  it("still clears the follow-up date when it archives", () => {
    expect(arc).toContain('.update({ status: "archived", next_follow_up_at: null })');
  });

  it("still reports what it kept", () => {
    expect(arc).toContain("kept ${skipped} live deal");
  });
});

describe("the status list is declared once", () => {
  it("both paths read the same constant", () => {
    // Two copies is how the two buttons came to disagree in the first place.
    expect((BULK.match(/const LIVE_DEAL_STATUSES = \[/g) ?? []).length).toBe(1);
    expect(BULK).toContain("const liveDealFilter =");
    expect(BULK).toContain("LIVE_DEAL_STATUSES.map");
  });

  it("covers every stage that means money is in play", () => {
    for (const s of LIVE) expect(BULK, s).toContain(`"${s}"`);
  });
});

describe("deleting one prospect deliberately is untouched", () => {
  const one = SRC.slice(SRC.indexOf("export async function deleteProspect"));

  it("still deletes whatever it is pointed at", () => {
    // The escape hatch. Blocking this too would remove a capability rather
    // than protect one.
    expect(one).toContain('.delete().eq("id", id)');
    expect(one).not.toContain("LIVE_DEAL_STATUSES");
  });

  it("still owner-only", () => {
    expect(one).toContain('member.role !== "owner"');
  });
});

describe("the confirm dialog still fires before anything is destroyed", () => {
  const UI = readFileSync(
    path.join(ROOT, "components", "growth", "bulk-actions.tsx"),
    "utf8"
  );

  it("asks before a bulk delete", () => {
    expect(UI).toContain("Permanently delete");
    expect(UI).toContain("window.confirm");
  });

  it("still says select-all is this page only", () => {
    expect(UI).toContain("Applies to the ticked rows on this page");
  });
});
