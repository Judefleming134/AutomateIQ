import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isAutoQueueable, type QueueableCandidate } from "./queueable";
import { isAutoQueueable as viaAutopilot } from "./autopilot";

/**
 * "May this draft be auto-queued for the 07:00 send?" was answered in three
 * places.
 *
 *   lib/growth/autopilot.ts        isAutoQueueable() — what the cron filters with
 *   email-autopilot.tsx line 66    the count on the buttons
 *   email-autopilot.tsx line 234   each row's defaultChecked
 *
 * All three were the same expression, written out by hand:
 *
 *     !c.queued && !c.broken && c.staleKind !== "research"
 *
 * and `isAutoQueueable`'s own doc comment said it was exported "so the rule
 * lives in one place rather than inline in the caller" — a promise the code did
 * not keep. It could not: `autopilot.ts` opens with `import "server-only"`, so
 * the panel, a client component, could only ever take a TYPE import from it.
 * The duplication wasn't carelessness, it was a boundary nothing had crossed.
 *
 * THEY AGREE TODAY. This is hardening, not a live bug, and the tests below
 * assert the behaviour is byte-for-byte what it was.
 *
 * It is worth doing because the drift is silent and the cost is specific: the
 * panel exists to let Jude review exactly what the 07:00 run will send. If its
 * copy and the cron's rule ever diverge, the pre-ticked boxes stop matching the
 * send. He reviews the panel, sees twenty ticked, trusts it — and a different
 * twenty go out.
 *
 * That is not hypothetical in this codebase. The spam-complaint hold was
 * unreachable for weeks for exactly this reason: the webhook wrote
 * "SPAM COMPLAINT", the ramp searched for "COMPLAINED", and nothing connected
 * the two files. Same shape, one rule hand-copied across a boundary that
 * stopped it being shared.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const QUEUEABLE = readFileSync(path.join(ROOT, "lib", "growth", "queueable.ts"), "utf8");
const AUTOPILOT = readFileSync(path.join(ROOT, "lib", "growth", "autopilot.ts"), "utf8");
const PANEL = readFileSync(
  path.join(ROOT, "components", "growth", "email-autopilot.tsx"),
  "utf8"
);

const c = (over: Partial<QueueableCandidate> = {}): QueueableCandidate => ({
  queued: false,
  broken: null,
  staleKind: null,
  ...over,
});

/** Every reachable combination of the three fields the rule reads. */
const ALL: QueueableCandidate[] = [false, true].flatMap((queued) =>
  [null, "still contains a [placeholder]"].flatMap((broken) =>
    ([null, "research", "age"] as const).map((staleKind) =>
      c({ queued, broken, staleKind })
    )
  )
);

describe("the rule is unchanged", () => {
  it("a clean, fresh, unqueued draft is queueable", () => {
    expect(isAutoQueueable(c())).toBe(true);
  });

  it("a broken draft is not — the send gate would refuse it anyway", () => {
    expect(isAutoQueueable(c({ broken: "still contains a [placeholder]" }))).toBe(false);
  });

  it("a research-stale draft is not — the angle is out of date", () => {
    expect(isAutoQueueable(c({ staleKind: "research" }))).toBe(false);
  });

  it("an AGE-stale draft IS queueable — a cold intro doesn't rot", () => {
    // Deliberate: excluding it starved the run whenever a batch of drafts
    // crossed the 5-day mark together.
    expect(isAutoQueueable(c({ staleKind: "age" }))).toBe(true);
  });

  it("an already-queued draft is not — it would double-count", () => {
    expect(isAutoQueueable(c({ queued: true }))).toBe(false);
  });

  it("across every combination, it is exactly the original expression", () => {
    for (const x of ALL) {
      const original = !x.queued && !x.broken && x.staleKind !== "research";
      expect(isAutoQueueable(x), JSON.stringify(x)).toBe(original);
    }
  });

  it("exactly 2 of the 12 combinations are queueable", () => {
    // clean+fresh and clean+age-stale, both unqueued. A change to the rule
    // moves this number.
    expect(ALL.filter(isAutoQueueable).length).toBe(2);
  });
});

describe("there is now ONE definition", () => {
  it("the autopilot's export is the same function object", () => {
    // Re-exported, not reimplemented — so `import { isAutoQueueable } from
    // "@/lib/growth/autopilot"` (which the cron and its tests use) is literally
    // this function.
    expect(viaAutopilot).toBe(isAutoQueueable);
  });

  it("no file hand-writes the expression any more", () => {
    for (const [name, src] of [
      ["autopilot.ts", AUTOPILOT],
      ["email-autopilot.tsx", PANEL],
    ] as const) {
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(code, name).not.toContain('staleKind !== "research"');
    }
  });

  it("the panel calls it in both places it used to inline it", () => {
    expect(PANEL).toContain("const defaultTicked = candidates.filter(isAutoQueueable).length;");
    expect(PANEL).toContain("defaultChecked={isAutoQueueable(c)}");
    expect(PANEL).toContain('import { isAutoQueueable } from "@/lib/growth/queueable";');
  });

  it("the cron still filters with it", () => {
    expect(AUTOPILOT).toContain("clean = candidates.filter(isAutoQueueable);");
  });

  it("the autopilot keeps re-exporting it, so no existing import broke", () => {
    expect(AUTOPILOT).toContain('export { isAutoQueueable } from "@/lib/growth/queueable";');
  });
});

describe("the shared module is genuinely client-safe", () => {
  it("it is NOT server-only — that was the whole obstacle", () => {
    expect(QUEUEABLE).not.toContain('import "server-only"');
  });

  it("it imports nothing at all, so it can't pull a server module in", () => {
    expect(QUEUEABLE).not.toMatch(/^import /m);
  });

  it("autopilot.ts is still server-only, which is why this had to move", () => {
    expect(AUTOPILOT.startsWith('import "server-only";')).toBe(true);
  });

  it("the panel's only other autopilot reference is still type-only", () => {
    // A value import from autopilot would drag server-only into the client.
    expect(PANEL).toContain('import type { AutopilotCandidate } from "@/lib/growth/autopilot";');
    const valueImports = [...PANEL.matchAll(/^import (?!type )\{([^}]*)\} from "@\/lib\/growth\/autopilot"/gm)];
    expect(valueImports).toEqual([]);
  });
});

describe("the panel still behaves the same for Jude", () => {
  it("the pre-tick and the cron's filter are now provably the same call", () => {
    // What the panel ticks === what collectQueueableDrafts keeps.
    const pool = ALL;
    const panelTicks = pool.filter(isAutoQueueable);
    const cronKeeps = pool.filter(viaAutopilot);
    expect(panelTicks).toEqual(cronKeeps);
  });

  it("the flagged-for-rewrite rule is untouched and deliberately different", () => {
    // broken OR research-stale get the regenerate button; age-stale does not,
    // because it is still a valid send. That is a DIFFERENT question from
    // queueability and stays inline on purpose.
    expect(PANEL).toContain('c.broken || c.staleKind === "research"');
  });

  it("age-stale still reads as fine to send in the UI copy", () => {
    expect(PANEL).toContain("older draft, still fine to send");
  });
});
