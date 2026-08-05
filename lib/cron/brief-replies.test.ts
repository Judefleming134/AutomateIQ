import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * A batch of holiday auto-responders could push every real reply out of the
 * morning brief.
 *
 * OVERNIGHT REPLIES fetched the newest 10 inbound messages and filtered the
 * auto-replies out AFTERWARDS. The cap therefore ran before anything knew
 * which rows were people — the "cap applied before the still-to-work filter"
 * shape CLAUDE.md lists, on the section that reports the most valuable event
 * the engine produces.
 *
 * It is not a stretch case. One 07:00 run emails thirty companies; in August
 * eleven out-of-offices coming back is an ordinary Tuesday. Any real reply
 * older than those eleven was never fetched, so the brief said
 *
 *     OVERNIGHT REPLIES (0)      subject: "… 0 replies …"
 *
 * on a morning when two people had written back.
 *
 * And it fell nowhere else. STILL WAITING ON YOU deliberately starts at 24h
 * old — its own comment claims "there's no gap between them" — so a reply under
 * 24h that this cap dropped appeared in NEITHER section. Invisible in the one
 * place the day gets planned from, on the thing this file itself calls the most
 * expensive miss in the engine: they raised their hand and got silence.
 *
 * Fixed the way the SENT THIS MORNING block in the same file already does it:
 * scan wide enough to count honestly, print a readable slice, and say when the
 * printed list is shorter than the count.
 */

const SRC = readFileSync(
  path.resolve(import.meta.dirname, "..", "..", "lib", "cron", "jarvis-morning-brief.ts"),
  "utf8"
);

const REPLY_SCAN = 60;
const LIST_CAP = 10;

type Row = { kind: "human" | "auto"; id: string };

/** Newest first, as the query orders them: autos on top of older real replies. */
const night = (autos: number, humans: number): Row[] => [
  ...Array.from({ length: autos }, (_, i) => ({ kind: "auto" as const, id: `a${i}` })),
  ...Array.from({ length: humans }, (_, i) => ({ kind: "human" as const, id: `R${i + 1}` })),
];

/** Fetch, then filter, then display — the real order of operations. */
function brief(rows: Row[], limit: number) {
  const fetched = rows.slice(0, limit);
  const human = fetched.filter((m) => m.kind === "human");
  return {
    total: human.length,
    lines: human.slice(0, LIST_CAP).map((m) => m.id),
    autos: fetched.length - human.length,
  };
}

describe("auto-replies could bury every real reply", () => {
  it("an ordinary August morning reported zero replies when two people wrote", () => {
    const rows = night(11, 2);
    expect(brief(rows, 10).total).toBe(0); // what the brief said
    expect(brief(rows, REPLY_SCAN).total).toBe(2); // what was true
  });

  it("the worse the auto-reply batch, the more people vanish", () => {
    for (const [autos, humans] of [
      [11, 2],
      [25, 4],
      [40, 6],
    ]) {
      expect(brief(night(autos, humans), 10).total).toBe(0);
      expect(brief(night(autos, humans), REPLY_SCAN).total).toBe(humans);
    }
  });

  it("a quiet night was never affected, and still isn't", () => {
    // The cap only bit once auto-replies outnumbered the window, so most
    // mornings looked fine — which is why it survived this long.
    const rows = night(3, 2);
    expect(brief(rows, 10)).toEqual(brief(rows, REPLY_SCAN));
  });

  it("the display cap still holds the list to a readable length", () => {
    // Scanning wider must not turn the brief into a wall of text.
    const rows = night(0, 25);
    expect(brief(rows, REPLY_SCAN).total).toBe(25);
    expect(brief(rows, REPLY_SCAN).lines).toHaveLength(LIST_CAP);
  });

  it("a dropped reply landed in no other section", () => {
    // STILL WAITING ON YOU filters to inbound OLDER than 24h, so it cannot
    // catch what this cap dropped. This pins the claim rather than trusting it.
    expect(SRC).toContain("return inbound.created_at < since24h;");
  });
});

describe("the brief scans wide and prints short", () => {
  it("declares the two numbers separately", () => {
    expect(SRC).toContain("const REPLY_SCAN = 60");
    expect(SRC).toContain("const REPLY_LIST_CAP = 10");
    expect(SRC).toContain(".limit(REPLY_SCAN)");
    expect(SRC).not.toMatch(/\.gte\("created_at", since24h\)\s*\n\s*\.order\([^)]*\)\s*\n\s*\.limit\(10\)/);
  });

  it("counts people before the display cap, not after", () => {
    expect(SRC).toContain("const replyTotal = humanReplies.length");
    expect(SRC).toContain(".slice(0, REPLY_LIST_CAP)");
  });

  it("says so when the printed list is shorter than the count", () => {
    expect(SRC).toContain("const replyMore =");
    expect(SRC).toContain("replyTotal > replyLines.length");
  });

  it("marks the count as a floor if the scan itself filled up", () => {
    // Needs >60 inbound in a day, so it should never fire — which is exactly
    // why it must not fail silently.
    expect(SRC).toContain("const replyScanCapped = (inbound24hTotal ?? 0) > REPLY_SCAN");
    expect(SRC).toContain('`${replyTotal}${replyScanCapped ? "+" : ""}`');
    expect(SRC).toContain('count: "exact"');
  });
});

describe("every surface reports the real number", () => {
  const uses = [
    // Distinct needles: the weekend header is otherwise a superstring of the
    // weekday one, so a single form would let either satisfy both.
    [
      "the weekday section header",
      'section(`OVERNIGHT REPLIES (${replyCountLabel})`, replyLines, "No new replies',
    ],
    ["the weekday subject line", "}${replyCountLabel} replies, ${dueTotal} due"],
    [
      "the weekend section header",
      '? section(`OVERNIGHT REPLIES (${replyCountLabel})`, replyLines, "") + replyMore',
    ],
    // Anchored on its NEIGHBOUR because `${replyCountLabel} replies` alone
    // appears in several places. The neighbour moved on 2026-08-05 —
    // nightlyLines.length (a .limit(20) list length) became nightlyFixTotal
    // (the counted total), so the subject stopped disagreeing with its own
    // body. This test's subject is the reply count, which is unchanged.
    ["the weekend subject line", "${nightlyFixTotal} overnight fixes, ${replyCountLabel} replies`"],
    ["the weekend what-changed line", "${replyCountLabel} new repl"],
    ["the AI narrative input", "`Overnight replies (${replyCountLabel})"],
    ["the dispatch response detail", "(${replyCountLabel} replies,"],
  ] as const;

  for (const [where, needle] of uses) {
    it(`${where} uses the true count`, () => {
      expect(SRC).toContain(needle);
    });
  }

  it("no surface reports the line count as a reply count any more", () => {
    // The only surviving uses of replyLines.length are the "…and N more"
    // arithmetic and the weekend "is there anything to show" test.
    const code = SRC.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    const hits = code.match(/replyLines\.length/g) ?? [];
    expect(hits).toHaveLength(3);
    expect(code).not.toContain("OVERNIGHT REPLIES (${replyLines.length})");
    expect(code).not.toContain("${replyLines.length} replies");
  });
});

describe("nothing else about the brief moved", () => {
  it("auto-replies are still counted and named, not dropped", () => {
    expect(SRC).toContain("const nonHumanCount =");
    expect(SRC).toContain("auto-reply/opt-out");
    expect(SRC).toContain("logged, not counted as replies.");
  });

  it("still classifies with the same shared rule as the webhook", () => {
    expect(SRC).toContain("classifyInbound");
    expect(SRC).toContain('.kind === "human"');
  });

  it("still guarantees a brief even when the data layer fails", () => {
    expect(SRC).toContain("sending minimal fallback");
    expect(SRC).toContain("Jarvis brief — ${today} (lite)");
  });

  it("still reports the true totals the earlier fixes established", () => {
    expect(SRC).toContain("const awaitingTotal = stillWaiting.length");
    expect(SRC).toContain("const SENT_LIST_CAP = 35");
    expect(SRC).toContain("sentTodayTotal");
  });
});
