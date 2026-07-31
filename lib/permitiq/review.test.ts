import { describe, it, expect } from "vitest";
import { normaliseReview, buildFactsBlock } from "@/lib/permitiq/review";
import {
  buildChecklist,
  summariseChecklist,
  type Requirement,
} from "@/lib/permitiq/checklist";

const req = (code: string, over: Partial<Requirement> = {}): Requirement => ({
  code,
  label: code.replace(/_/g, " "),
  guidance: null,
  mandatory: true,
  sort_order: 10,
  authority: null,
  ...over,
});

describe("buildFactsBlock — arithmetic is never delegated to the model", () => {
  const reqs = [
    req("site_location_map", { sort_order: 10 }),
    req("floor_plans", { sort_order: 20 }),
    req("flood_risk", { mandatory: false, sort_order: 30 }),
  ];
  const checklist = buildChecklist(reqs, [
    { id: "d1", name: "os-map.pdf", doc_type: "site_location_map" },
  ]);
  const summary = summariseChecklist(checklist);

  const facts = buildFactsBlock({
    applicationType: "planning_permission",
    jurisdiction: "ie",
    authority: "Fingal County Council",
    siteAddress: "12 Main St, Swords",
    checklist,
    summary,
    documents: [
      { name: "os-map.pdf", summary: "An Ordnance Survey site location map.", issues: [] },
      { name: "sketch.pdf", issues: ["No scale bar"] },
    ],
  });

  it("states the counts as facts the model must not recount", () => {
    expect(facts).toContain("do not recount them");
    expect(facts).toContain("1 MANDATORY items are missing");
    expect(facts).toContain("1 have evidence attached");
    expect(facts).toContain("Ready to submit: NO");
  });

  it("the stated counts match the checklist they came from", () => {
    // The whole point of the block: if these drift, the summary is wrong no
    // matter how good the prompt is.
    expect(summary.satisfied).toBe(1);
    expect(summary.missingMandatory).toBe(1);
    expect(facts).toContain(`${summary.total} requirements apply`);
    expect(facts).toContain(`${summary.unclear} items are unclear`);
  });

  it("lists every checklist item with its state and reason", () => {
    expect(facts).toContain("[SATISFIED]");
    expect(facts).toContain("[MISSING]");
    expect(facts).toContain("(required)");
    expect(facts).toContain("(if it applies)");
  });

  it("marks an unread document as unread rather than implying it's fine", () => {
    expect(facts).toContain("sketch.pdf (not read)");
    expect(facts).toContain("issue found: No scale bar");
  });

  it("says plainly when no authority was named", () => {
    const f = buildFactsBlock({
      applicationType: "planning_permission",
      jurisdiction: "ie",
      authority: null,
      siteAddress: null,
      checklist: [],
      summary: summariseChecklist([]),
      documents: [],
    });
    expect(f).toContain("national requirements apply");
    expect(f).toContain("- none");
  });

  it("renders the US jurisdiction as the United States", () => {
    const f = buildFactsBlock({
      applicationType: "building_permit",
      jurisdiction: "us",
      authority: null,
      siteAddress: null,
      checklist: [],
      summary: summariseChecklist([]),
      documents: [],
    });
    expect(f).toContain("United States");
  });
});

describe("normaliseReview", () => {
  it("keeps a well-formed review", () => {
    const out = normaliseReview({
      summary: "A two-storey rear extension in Swords.",
      risk_flags: [{ severity: "high", title: "Floor plans missing", detail: "Required." }],
      next_steps: ["Upload the floor plans"],
    });
    expect(out.summary).toContain("Swords");
    expect(out.riskFlags).toHaveLength(1);
    expect(out.nextSteps).toEqual(["Upload the floor plans"]);
  });

  it("sorts high risks above medium and low", () => {
    // A missing mandatory document must never sit below "check the north arrow".
    const out = normaliseReview({
      summary: "x",
      risk_flags: [
        { severity: "low", title: "North arrow", detail: "" },
        { severity: "high", title: "Site notice missing", detail: "" },
        { severity: "medium", title: "No scale bar", detail: "" },
      ],
      next_steps: [],
    });
    expect(out.riskFlags.map((f) => f.severity)).toEqual(["high", "medium", "low"]);
  });

  it("defaults an unrecognised severity to low rather than high", () => {
    const out = normaliseReview({
      summary: "x",
      risk_flags: [{ severity: "critical", title: "Something", detail: "" }],
      next_steps: [],
    });
    expect(out.riskFlags[0].severity).toBe("low");
  });

  it("drops a flag with no title — an untitled risk tells the applicant nothing", () => {
    const out = normaliseReview({
      summary: "x",
      risk_flags: [
        { severity: "high", title: "", detail: "something" },
        { severity: "high", title: "Real one", detail: "" },
      ],
      next_steps: [],
    });
    expect(out.riskFlags.map((f) => f.title)).toEqual(["Real one"]);
  });

  it("caps flags and steps so one runaway response can't fill the page", () => {
    const out = normaliseReview({
      summary: "x",
      risk_flags: Array.from({ length: 40 }, (_, i) => ({
        severity: "low",
        title: `flag ${i}`,
        detail: "",
      })),
      next_steps: Array.from({ length: 40 }, (_, i) => `step ${i}`),
    });
    expect(out.riskFlags.length).toBeLessThanOrEqual(12);
    expect(out.nextSteps.length).toBeLessThanOrEqual(8);
  });

  it("survives junk without throwing", () => {
    for (const junk of [null, undefined, {}, { risk_flags: "nope" }, []]) {
      const out = normaliseReview(junk);
      expect(typeof out.summary).toBe("string");
      expect(Array.isArray(out.riskFlags)).toBe(true);
      expect(Array.isArray(out.nextSteps)).toBe(true);
    }
  });

  it("never returns an empty summary", () => {
    expect(normaliseReview({ summary: "  " }).summary.length).toBeGreaterThan(0);
  });
});
