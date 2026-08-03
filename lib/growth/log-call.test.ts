import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * "Log call" reported success for work that didn't happen.
 *
 * Every tap of the primary button on the call list does TWO writes:
 *
 *   1. insert the activity into `ge_activities`   — the error WAS checked
 *   2. update `ge_prospects`: `last_contact_at`, the chase date, the stage
 *                                                 — the error was NOT checked
 *
 * Write 2 is the one that matters operationally: it books the chase date the
 * footnote under the button promises ("Logging the call schedules the follow-up
 * automatically"). Losing it silently means the same number back with no next
 * step booked and nothing anywhere saying so — the card showed a green "✓ Done"
 * either way.
 *
 * UPDATED 2026-08-03. This file used to say `last_contact_at` (part of write 2)
 * was the only thing that dropped a lead off today's call list. That is no
 * longer true, and the test at the bottom existed to force this reread when it
 * changed. The column is stamped by recordOutreachSent on EVERY outreach touch,
 * so the 07:00 email autopilot was hiding its own thirty best-scored prospects
 * from the call list; the page now asks the timeline instead — a `call` or
 * `meeting` activity today, which is WRITE 1.
 *
 * The consequence that reasoning is built on has therefore MOVED, not gone:
 *
 *   - Write 1 failing → nothing is recorded and the action returns early, so
 *     the lead correctly stays on today's list. Unchanged.
 *   - Write 2 failing → the lead now DOES drop off today (write 1 already
 *     landed) but with no chase in the diary. It comes back tomorrow, because
 *     the drop only covers today — so this is not a leak, but it is still
 *     exactly the case the error return below must surface, and it is why that
 *     error must never go back to being swallowed.
 *
 * Two ways it went wrong, both silent:
 *
 *   - the update returned an error, which was discarded
 *   - the prospect READ returned null, and `if (p)` skipped the whole bump.
 *     `.maybeSingle()` gives `data: null` on a failed read exactly as it does
 *     on a missing row, so a read failure was a guaranteed no-op with an ok.
 *
 * `logNoAnswer` — the button immediately beside it on the same card — has
 * checked its bump error since K7 and is already pinned by chase.test.ts. The
 * more-tapped path was the one still swallowing it.
 */

const SRC = readFileSync(
  path.resolve(
    import.meta.dirname, "..", "..", "app", "growth", "(app)", "prospects", "actions.ts"
  ),
  "utf8"
);

/** Just addActivity — from its own `export` to the next one. */
const ADD_ACTIVITY = (() => {
  const from = SRC.indexOf("export async function addActivity");
  expect(from, "addActivity not found").toBeGreaterThan(-1);
  const next = SRC.indexOf("\nexport async function ", from + 1);
  return SRC.slice(from, next === -1 ? SRC.length : next);
})();

describe("a failed reschedule is never reported as a logged call", () => {
  it("captures the update error instead of discarding it", () => {
    // THE bug, in one line: `await admin.from("ge_prospects").update(bump)`
    // with no destructure at all.
    expect(ADD_ACTIVITY).toContain("bumpError");
    expect(ADD_ACTIVITY).toMatch(/const \{ error: bumpError \}\s*=\s*await admin/);
  });

  it("returns an error rather than { ok: true } when it fails", () => {
    expect(ADD_ACTIVITY).toMatch(/if \(bumpError\)/);
    const branch = ADD_ACTIVITY.slice(ADD_ACTIVITY.indexOf("if (bumpError)"));
    expect(branch).toContain("scheduling the follow-up failed");
    // And it says what to do about it — an error with no instruction on a
    // dial day is just noise.
    expect(branch).toContain("Set the next step by hand");
  });

  it("no longer fires the update as a bare statement", () => {
    // Reverting to `await admin.from("ge_prospects").update(bump).eq(...)`
    // with nothing on the left is what this whole file exists to catch.
    expect(ADD_ACTIVITY).not.toMatch(
      /\n\s*await admin\s*\n?\s*\.from\("ge_prospects"\)\s*\n?\s*\.update\(bump\)/
    );
  });
});

describe("a failed prospect READ is not a silent no-op either", () => {
  it("keeps the read's own error, rather than only its data", () => {
    // It used to take `.data` off the response inline, so the error was
    // unreachable and a read failure was indistinguishable from a note.
    expect(ADD_ACTIVITY).toContain("read?.error");
    expect(ADD_ACTIVITY).toContain("const p = read?.data ?? null");
  });

  it("refuses to claim a follow-up it could not schedule", () => {
    expect(ADD_ACTIVITY).toMatch(/if \(!p\)/);
    const branch = ADD_ACTIVITY.slice(ADD_ACTIVITY.indexOf("if (!p)"));
    expect(branch).toContain("no follow-up was scheduled");
  });

  it("only applies to a call or a meeting — a note has no prospect read", () => {
    // Notes deliberately never touch the pipeline, so `p` is null for every
    // one of them. Erroring there would break the note box on the workspace.
    const guard = ADD_ACTIVITY.indexOf('if (type === "call" || type === "meeting")');
    const notP = ADD_ACTIVITY.indexOf("if (!p)");
    expect(guard, "the call/meeting guard moved").toBeGreaterThan(-1);
    expect(notP).toBeGreaterThan(guard);
    // …and the read itself is still conditional on the same two types.
    expect(ADD_ACTIVITY).toMatch(/type === "call" \|\| type === "meeting"\s*\n?\s*\?\s*await admin/);
  });
});

describe("the timeline refreshes whichever way it goes", () => {
  // The activity insert has already succeeded by the time either error is
  // returned. An early return that skipped revalidatePath would leave the page
  // showing a call that isn't on it — an error AND a missing entry.
  it("both error paths refresh before returning", () => {
    const notP = ADD_ACTIVITY.slice(ADD_ACTIVITY.indexOf("if (!p)"));
    expect(notP.slice(0, notP.indexOf("return"))).toContain("refresh()");
    const bump = ADD_ACTIVITY.slice(ADD_ACTIVITY.indexOf("if (bumpError)"));
    expect(bump.slice(0, bump.indexOf("return"))).toContain("refresh()");
  });

  it("the success path still refreshes exactly what it always did", () => {
    // Nothing removed: the same three paths, now behind one helper.
    expect(ADD_ACTIVITY).toContain("revalidatePath(`/growth/prospects/${id}`)");
    expect(ADD_ACTIVITY).toContain('if (type === "call") revalidatePath("/growth/call-list")');
    expect(ADD_ACTIVITY).toContain('revalidatePath("/growth")');
  });

  it("logNoAnswer refreshes on its error path too", () => {
    // Same defect, smaller: it correctly refused the false ok, but returned
    // before revalidating, so the attempt it HAD logged stayed off screen.
    const NO_ANSWER = SRC.slice(
      SRC.indexOf("export async function logNoAnswer"),
      SRC.indexOf("export async function addActivity")
    );
    const branch = NO_ANSWER.slice(NO_ANSWER.indexOf("if (bumpError)"));
    expect(branch.slice(0, branch.indexOf("return"))).toContain("revalidatePath");
  });
});

describe("nothing about the working path changed", () => {
  it("still stamps last_contact_at on a call or meeting", () => {
    expect(ADD_ACTIVITY).toMatch(/last_contact_at: new Date\(\)\.toISOString\(\)/);
  });

  it("still writes the chase date only when genuinely rescheduling", () => {
    expect(ADD_ACTIVITY).toMatch(/if \(chase && !chase\.kept\) bump\.next_follow_up_at/);
  });

  it("still nudges an untouched prospect to contacted, and no later stage", () => {
    expect(ADD_ACTIVITY).toContain('"new", "researching", "research_complete", "outreach_ready"');
    expect(ADD_ACTIVITY).toContain('bump.status = "contacted"');
  });

  it("still accepts a one-tap call with no note written", () => {
    // The whole point of the call-list button: no text, one tap.
    expect(ADD_ACTIVITY).toContain('const fallback = type === "call" ? "Call made"');
  });
});

describe("the call list still promises only what the action delivers", () => {
  const CARD = readFileSync(
    path.resolve(
      import.meta.dirname, "..", "..", "app", "growth", "(app)", "call-list", "page.tsx"
    ),
    "utf8"
  );

  it("the footnote under the button is the claim being backed", () => {
    expect(CARD).toContain("Logging the call schedules the follow-up automatically");
  });

  it("the button still posts through addActivity as a call", () => {
    expect(CARD).toContain("action={addActivity}");
    expect(CARD).toContain('name="type" value="call"');
  });

  it("the form still renders the error the action returns", () => {
    // ActionForm is what puts { error } on screen; a plain <form action={fn}>
    // would throw the message away and the fix with it.
    const FORM = readFileSync(
      path.resolve(import.meta.dirname, "..", "..", "components", "admin", "action-form.tsx"),
      "utf8"
    );
    expect(FORM).toContain("state?.error");
  });

  it("a logged call is still what drops a lead off the list", () => {
    // The tripwire this replaces pinned `p.last_contact_at >= todayStart` and
    // fired when the filter changed — which is what it was for. See the
    // UPDATED note at the top of this file for what moved.
    //
    // The invariant it was really protecting is unchanged and is what is
    // pinned now: tapping the button on this card is what takes the lead off
    // today's list. It is just write 1 that does it rather than write 2.
    expect(CARD).toContain("workedTodayIds.has(p.id)");
    expect(CARD).toContain('.in("type", ["call", "meeting"])');
    // And the write that does it is the one whose error is already checked.
    expect(ADD_ACTIVITY).toContain('.from("ge_activities")');
    expect(ADD_ACTIVITY).toMatch(/if \(error\) return \{ error: error\.message \};/);
  });
});
