import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Six independent head-counts in the 07:00 brief were running one after another.
 *
 * Four sat together near the top, two more two hundred lines below. Each was a
 * full round trip to Postgres, each waited for the one before it, and none used
 * any other's result:
 *
 *     sent24h  replyDrafts24h  leadsAdded24h
 *     researchedOvernight  chaseDraftsOvernight  goneColdCount
 *
 * They sit inside the 07:00 dispatch, which has a 60-second budget shared with
 * the booking sync, both queue steps, the invoice-chaser settle and the brief's
 * own AI call. The brief runs LAST, so every serial round trip here is spent
 * out of the margin that decides whether Jude gets a brief at all.
 *
 * `head: true` means no rows come back, so the only cost these ever had was
 * latency — which is precisely the cost parallelising removes. Six sequential
 * waits become one.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SRC = readFileSync(path.join(ROOT, "lib", "cron", "jarvis-morning-brief.ts"), "utf8");
const BODY = SRC.slice(SRC.indexOf("export async function sendJarvisMorningBrief"));
/** Comments stripped — the file explains what it used to do. */
const CODE = BODY.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const COUNTS = [
  "sent24h",
  "replyDrafts24h",
  "leadsAdded24h",
  "researchedOvernight",
  "chaseDraftsOvernight",
  "goneColdCount",
] as const;

describe("the six counts now cost one round trip", () => {
  it("none of them is a standalone await any more", () => {
    for (const name of COUNTS) {
      expect(CODE, `${name} is still serial`).not.toMatch(
        new RegExp(`const \\{ count: ${name} \\} = await admin`)
      );
    }
  });

  it("all six are destructured from one Promise.all", () => {
    const block = CODE.slice(
      CODE.indexOf("const [\n      { count: sent24h },"),
      CODE.indexOf("]);", CODE.indexOf("const [\n      { count: sent24h },"))
    );
    expect(block).toBeTruthy();
    for (const name of COUNTS) expect(block).toContain(`{ count: ${name} }`);
    expect(block).toContain("await Promise.all([");
  });

  it("every one of them is still head:true, so no rows are fetched", () => {
    // The whole reason parallelising is free here.
    const block = CODE.slice(CODE.indexOf("const [\n      { count: sent24h },"));
    const upToClose = block.slice(0, block.indexOf("]);"));
    expect((upToClose.match(/count: "exact", head: true/g) ?? []).length).toBe(6);
  });
});

describe("each count still asks exactly what it asked before", () => {
  const block = CODE.slice(CODE.indexOf("const [\n      { count: sent24h },"));
  const upToClose = block.slice(0, block.indexOf("]);"));

  it.each([
    ["sent outreach in 24h", '.eq("status", "sent")', '.gte("sent_at", since24h)'],
    ["reply drafts", '.eq("purpose", "reply")', '.eq("status", "draft")'],
    ["leads added", '.from("ge_prospects")', '.gte("created_at", since24h)'],
    ["research done overnight", '.from("ge_research")', '.gte("updated_at", since24h)'],
    ["chase drafts", '.in("purpose", ["follow_up", "second_follow_up"])', '.eq("status", "draft")'],
    ["gone cold", '.lt("next_follow_up_at", dublinDate(-7))', '.not("status", "in", activeFilter)'],
  ])("%s", (_label, a, b) => {
    expect(upToClose).toContain(a);
    expect(upToClose).toContain(b);
  });
});

describe("nothing reads a count earlier than it used to", () => {
  it("the two that moved up are still consumed well after the batch", () => {
    // Declaring them earlier is only safe because nothing between the old and
    // new declaration points touches them.
    const batchEnd = CODE.indexOf("]);", CODE.indexOf("const [\n      { count: sent24h },"));
    for (const name of ["leadsAdded24h", "goneColdCount"]) {
      const firstUse = CODE.indexOf(name, batchEnd);
      expect(firstUse, `${name} unused after the batch`).toBeGreaterThan(batchEnd);
    }
  });

  it("the weekend brief still reports leads added and the gone-cold pile", () => {
    expect(SRC).toContain("${leadsAdded24h ?? 0} new lead");
    expect(SRC).toContain("${goneColdCount} gone cold (7+ days overdue)");
  });

  it("the overnight headline still uses research and chase drafts", () => {
    expect(SRC).toContain("${researchedOvernight ?? 0} lead");
    expect(SRC).toContain("${chaseDraftsOvernight ?? 0} follow-up");
  });

  it("the reply-draft nudge still fires off its count", () => {
    expect(SRC).toContain("(replyDrafts24h ?? 0) > 0");
  });

  it("sent24h still feeds the narrative", () => {
    expect(SRC).toContain("sent24h");
  });
});

describe("the brief's guarantees are untouched", () => {
  it("still sends a minimal fallback if the data layer blows up", () => {
    expect(SRC).toContain("sending minimal fallback");
    expect(SRC).toContain("Jarvis brief — ${today} (lite)");
  });

  it("still counts real replies before the display cap", () => {
    expect(SRC).toContain("const replyTotal = humanReplies.length");
  });

  it("still reports the true sent-this-morning total, not the list length", () => {
    expect(SRC).toContain("const SENT_LIST_CAP = 35");
    expect(SRC).toContain("sentTodayTotal");
  });

  it("still counts everyone still waiting before capping the list", () => {
    expect(SRC).toContain("const awaitingTotal = stillWaiting.length");
  });
});
