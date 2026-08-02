import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The free tools catalog.
 *
 * The bug this exists to prevent: the hub hard-coded six tools and the
 * headline "Six things you can check right now, for nothing", while the Google
 * Business Profile checker was switched off for want of an API key. A visitor
 * read a promise of six working tools, clicked the second card, and landed on
 * "Not switched on yet". The API's own error text already said "The other free
 * tools all work" — the hub was the only surface that didn't know.
 *
 * These are front doors. Someone who has never heard of AutomateIQ judges the
 * whole product by whether the free thing worked.
 *
 * The env is mutated per test, so the module is re-imported each time rather
 * than read once at the top.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");

const KEYS = [
  "GOOGLE_PLACES_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

async function load() {
  // Fresh module per call. A "?t=" cache-buster would work in Node but makes
  // vite lose the .ts extension and parse the file as JavaScript.
  vi.resetModules();
  return import("./catalog");
}

describe("tool availability tracks the environment", () => {
  it("marks everything live when every key is present", async () => {
    process.env.GOOGLE_PLACES_API_KEY = "k";
    process.env.ANTHROPIC_API_KEY = "k";
    const { toolCards, liveToolCount, totalToolCount } = await load();
    expect(liveToolCount()).toBe(totalToolCount());
    expect(toolCards().every((t) => t.status === "live")).toBe(true);
  });

  it("keeps the Google check LIVE without a Places key — it no longer needs one", async () => {
    // This used to assert the opposite, and it was right to: the tool ran the
    // Places API or nothing, so with no key it was a dead card and the hub had
    // to say so. J1 removed the gate — without a key it asks the seven
    // questions the API was answering and scores them with the same engine, so
    // there is no off state left to advertise. The mechanism is untouched and
    // still governs the review writer below; this tool simply opted out of it.
    process.env.ANTHROPIC_API_KEY = "k";
    const { toolCards, liveToolCount } = await load();
    const gbp = toolCards().find((t) => t.slug === "google-profile")!;
    expect(gbp.status).toBe("live");
    expect(gbp.unavailableNote).toBeNull();
    expect(liveToolCount()).toBe(6);
  });

  it("stays live with a key too — a key upgrades it, it does not switch it on", async () => {
    process.env.GOOGLE_PLACES_API_KEY = "k";
    process.env.ANTHROPIC_API_KEY = "k";
    const { toolCards } = await load();
    expect(toolCards().find((t) => t.slug === "google-profile")!.status).toBe("live");
  });

  it("marks the review writer unavailable with no AI provider", async () => {
    // The gating mechanism itself still works — proven here, on the tool that
    // genuinely still depends on a paid key.
    process.env.GOOGLE_PLACES_API_KEY = "k";
    const { toolCards } = await load();
    expect(toolCards().find((t) => t.slug === "reviews")!.status).toBe("unavailable");
  });

  it("accepts Gemini as an AI provider, not just Anthropic", async () => {
    process.env.GEMINI_API_KEY = "k";
    const { toolCards } = await load();
    expect(toolCards().find((t) => t.slug === "reviews")!.status).toBe("live");
  });

  it("keeps the offline-safe tools live with no keys at all", async () => {
    // These run in the browser or against the visitor's own site. They must
    // never be marked unavailable — that would be its own lie.
    const { toolCards } = await load();
    const byStatus = Object.fromEntries(toolCards().map((t) => [t.slug, t.status]));
    expect(byStatus["missed-calls"]).toBe("live");
    expect(byStatus["quote-builder"]).toBe("live");
    expect(byStatus["autoseo"]).toBe("live");
    expect(byStatus["response-time"]).toBe("live");
  });

  it("never reports more live tools than it has", async () => {
    const { liveToolCount, totalToolCount } = await load();
    expect(liveToolCount()).toBeLessThanOrEqual(totalToolCount());
  });
});

describe("a switched-off tool is never the visitor's first click", () => {
  it("sorts live tools ahead of unavailable ones", async () => {
    // The Google check sat SECOND in the grid while it was dead.
    process.env.ANTHROPIC_API_KEY = "k";
    const { toolCards } = await load();
    const statuses = toolCards().map((t) => t.status);
    const firstDead = statuses.indexOf("unavailable");
    if (firstDead !== -1) {
      expect(statuses.slice(firstDead).every((s) => s === "unavailable")).toBe(true);
    }
  });

  it("gives an unavailable tool an explanation, and a live one none", async () => {
    process.env.ANTHROPIC_API_KEY = "k";
    const { toolCards } = await load();
    for (const t of toolCards()) {
      if (t.status === "live") expect(t.unavailableNote).toBeNull();
      else expect(String(t.unavailableNote).length).toBeGreaterThan(20);
    }
  });
});

describe("the catalog describes tools honestly", () => {
  it("gives every tool concrete outputs, not benefit adjectives", async () => {
    const { ALL_TOOLS } = await load();
    for (const t of ALL_TOOLS) {
      expect(t.gives.length, t.slug).toBeGreaterThanOrEqual(3);
      expect(t.time, t.slug).toMatch(/second|minute/);
    }
  });

  it("points every tool at a page that exists", async () => {
    const { ALL_TOOLS } = await load();
    const { existsSync } = await import("node:fs");
    const missing = ALL_TOOLS.filter(
      (t) => !existsSync(path.join(ROOT, "app", ...t.href.split("/").filter(Boolean), "page.tsx"))
    );
    expect(missing.map((t) => t.href)).toEqual([]);
  });

  it("has a unique slug and href per tool", async () => {
    const { ALL_TOOLS } = await load();
    expect(new Set(ALL_TOOLS.map((t) => t.slug)).size).toBe(ALL_TOOLS.length);
    expect(new Set(ALL_TOOLS.map((t) => t.href)).size).toBe(ALL_TOOLS.length);
  });
});

describe("the hub page cannot go back to hard-coding", () => {
  const HUB = readFileSync(path.join(ROOT, "app", "freetools", "page.tsx"), "utf8");

  it("renders from the catalog rather than its own list", () => {
    expect(HUB).toContain("toolCards()");
    expect(HUB).toContain("liveToolCount()");
  });

  it("does not hard-code a tool count in the headline", () => {
    // "Six things you can check right now" is how this broke.
    const headline = HUB.slice(HUB.indexOf("<h1>"), HUB.indexOf("</h1>"));
    expect(headline).not.toMatch(/\b(Two|Three|Four|Five|Six|Seven)\b/);
    expect(headline).toContain("countWord(live)");
  });

  it("is rendered per request, so availability cannot freeze at build time", () => {
    // /freetools was `○ Static`, so the env check ran once during the build
    // and the page would keep its answer for the life of the deployment.
    expect(HUB).toMatch(/export const dynamic = "force-dynamic"/);
  });
});

describe("the homepage does not promise a tool count either", () => {
  const HTML = readFileSync(path.join(ROOT, "public", "index.html"), "utf8");

  it("claims no fixed number of working tools", () => {
    // It said "Six working tools" and "Open all six tools" while one was off.
    expect(HTML).not.toMatch(/six\s+(working\s+)?tools/i);
    expect(HTML).not.toMatch(/all six/i);
  });
});
