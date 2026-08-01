import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { summariseDmQueue } from "@/lib/growth/dm-list";

/**
 * The DM list's "still to DM" number was counting the wrong people.
 *
 * The page renders up to 40 ready DMs and then said:
 *
 *   "· 260 more still to DM — mark these sent and the next batch loads"
 *
 * counting every un-DM'd prospect with a profile link. But only a prospect
 * with a WRITTEN DRAFT can ever appear on this page. Work the 40 down and the
 * list does not refill — it flips straight to "you've DM'd everyone who has a
 * message ready", with 240 of that 260 revealed to have no message at all.
 *
 * So the headline number was inflated by an order of magnitude AND the promise
 * attached to it was false. The page already knew the difference — its own
 * empty state distinguishes the two — the header just conflated them. That is
 * the "count that doesn't match what its click-through shows" shape, on the
 * one number Jude reads to decide whether he is finished for the day.
 */

describe("the bug: un-drafted prospects counted as ready to DM", () => {
  it("splits the inflated number into the two real populations", () => {
    // 300 un-DM'd with a link, only 60 have a draft, 40 on screen.
    const q = summariseDmQueue({
      shown: 40,
      ready: 60,
      available: 300,
      lookupCapped: true,
      poolMaxedOut: false,
    });
    // OLD: available - shown = 260 "more still to DM". Wrong on both counts.
    expect(300 - 40).toBe(260);
    expect(q.readyBeyond).toBe(20); // what marking sent actually loads
    expect(q.awaitingDraft).toBe(240); // what needs writing, not DMing
  });

  it("promises nothing more when the screen holds everything ready", () => {
    const q = summariseDmQueue({
      shown: 12,
      ready: 12,
      available: 400,
      lookupCapped: true,
      poolMaxedOut: false,
    });
    expect(q.readyBeyond).toBe(0); // no false "the next batch loads"
    expect(q.awaitingDraft).toBe(388);
  });

  it("counts a full screen with more behind it correctly", () => {
    const q = summariseDmQueue({
      shown: 40,
      ready: 150,
      available: 150,
      lookupCapped: false,
      poolMaxedOut: false,
    });
    expect(q.readyBeyond).toBe(110);
    expect(q.awaitingDraft).toBe(0); // everyone available is drafted
  });
});

describe("neither number can go negative", () => {
  it.each([
    ["ready below shown", { shown: 40, ready: 10, available: 100 }],
    ["available below ready", { shown: 5, ready: 60, available: 20 }],
    ["everything zero", { shown: 0, ready: 0, available: 0 }],
  ])("%s", (_label, input) => {
    const q = summariseDmQueue({ ...input, lookupCapped: false, poolMaxedOut: false });
    expect(q.readyBeyond).toBeGreaterThanOrEqual(0);
    expect(q.awaitingDraft).toBeGreaterThanOrEqual(0);
  });

  it("stays sane when the lookup window truncated available below ready", () => {
    // `ready` is counted inside the 150-row lookup window while `available`
    // spans the whole pool, so the subtraction is only meaningful downward.
    const q = summariseDmQueue({
      shown: 40,
      ready: 150,
      available: 150,
      lookupCapped: true,
      poolMaxedOut: true,
    });
    expect(q.awaitingDraft).toBe(0);
  });
});

describe("a capped number is never presented as the whole truth", () => {
  it("marks approximate when the draft lookup was capped", () => {
    expect(
      summariseDmQueue({ shown: 40, ready: 60, available: 300, lookupCapped: true, poolMaxedOut: false })
        .approximate
    ).toBe(true);
  });

  it("marks approximate when the prospect pool hit its limit", () => {
    expect(
      summariseDmQueue({ shown: 40, ready: 60, available: 300, lookupCapped: false, poolMaxedOut: true })
        .approximate
    ).toBe(true);
  });

  it("is exact when neither cap was hit", () => {
    expect(
      summariseDmQueue({ shown: 40, ready: 60, available: 80, lookupCapped: false, poolMaxedOut: false })
        .approximate
    ).toBe(false);
  });
});

describe("the finish line still reads as a finish line", () => {
  it("says nothing is left when everything is DM'd and nothing is undrafted", () => {
    const q = summariseDmQueue({
      shown: 0,
      ready: 0,
      available: 0,
      lookupCapped: false,
      poolMaxedOut: false,
    });
    expect(q).toEqual({ readyBeyond: 0, awaitingDraft: 0, approximate: false });
  });

  it("distinguishes 'nobody left' from 'plenty left, none drafted'", () => {
    // The two empty states the page has always had — the header now agrees
    // with them instead of contradicting them.
    const done = summariseDmQueue({ shown: 0, ready: 0, available: 0, lookupCapped: false, poolMaxedOut: false });
    const undrafted = summariseDmQueue({ shown: 0, ready: 0, available: 240, lookupCapped: true, poolMaxedOut: false });
    expect(done.awaitingDraft).toBe(0);
    expect(undrafted.awaitingDraft).toBe(240);
  });
});

describe("the page is wired to it", () => {
  const PAGE = readFileSync(
    path.resolve(import.meta.dirname, "..", "..", "app", "growth", "(app)", "dms", "page.tsx"),
    "utf8"
  );
  const CODE = PAGE.replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("uses the shared summary", () => {
    expect(CODE).toContain("summariseDmQueue({");
  });

  it("no longer subtracts shown items from the un-DM'd pool", () => {
    // The bug, in one expression.
    expect(CODE).not.toMatch(/available\.length - items\.length/);
  });

  it("builds every ready item before slicing, so the count is real", () => {
    // The old loop broke at MAX_ITEMS, which is exactly why the page could
    // not know how many more were genuinely ready.
    expect(CODE).toContain("const items = ready.slice(0, MAX_ITEMS)");
    expect(CODE).not.toMatch(/if \(items\.length >= MAX_ITEMS\) break/);
  });

  it("only promises a next batch for drafts that really exist", () => {
    expect(CODE).toMatch(/queue\.readyBeyond > 0/);
    expect(CODE).toContain("more ready");
    expect(CODE).toContain("mark these sent and the next batch loads");
  });

  it("sends the undrafted ones somewhere useful instead", () => {
    expect(CODE).toMatch(/queue\.awaitingDraft > 0/);
    expect(CODE).toContain("still need a DM written");
  });

  it("tells the truth about a capped count in both places", () => {
    expect(CODE).toContain("const plus = queue.approximate");
    // Header and empty state both read the same flag.
    expect(CODE.match(/\{plus\}/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps the send flow untouched — nothing Jude uses was removed", () => {
    expect(CODE).toContain("DmSendButton");
    expect(CODE).toContain("markMessageSent");
    expect(CODE).toContain("Copy only");
    expect(CODE).toContain("Fix in Studio");
  });

  it("still sanitises and flags broken drafts before they can be copied", () => {
    expect(CODE).toContain("sanitizeOutreachBody(draft.body)");
    expect(CODE).toContain("draftLooksBroken(body)");
  });

  it("still excludes anyone already DM'd", () => {
    expect(CODE).toContain("alreadyDmd");
    expect(CODE).toContain("selectAllRows");
  });
});
