import { describe, it, expect } from "vitest";
import {
  resolveRequirements,
  buildChecklist,
  summariseChecklist,
  type Requirement,
  type UploadedDocument,
} from "@/lib/permitiq/checklist";

const req = (
  code: string,
  over: Partial<Requirement> = {}
): Requirement => ({
  code,
  label: code.replace(/_/g, " "),
  guidance: null,
  mandatory: true,
  sort_order: 10,
  authority: null,
  ...over,
});

const doc = (id: string, name: string, doc_type: string | null): UploadedDocument => ({
  id,
  name,
  doc_type,
});

describe("resolveRequirements — authority overrides the national baseline", () => {
  const all = [
    req("site_location_map", { sort_order: 10 }),
    req("site_layout_plan", { sort_order: 20 }),
    req("site_layout_plan", {
      authority: "Fingal County Council",
      label: "Site layout plan (1:500, Fingal)",
      sort_order: 20,
    }),
    req("tree_survey", {
      authority: "Fingal County Council",
      label: "Tree survey",
      sort_order: 25,
    }),
    req("other_council_rule", { authority: "Cork City Council", sort_order: 15 }),
  ];

  it("keeps the national baseline when no authority is chosen", () => {
    const out = resolveRequirements(all, null);
    expect(out.map((r) => r.code)).toEqual(["site_location_map", "site_layout_plan"]);
    expect(out[1].label).toBe("site layout plan");
  });

  it("lets the authority's wording win WITHOUT duplicating the item", () => {
    const out = resolveRequirements(all, "Fingal County Council");
    const layout = out.filter((r) => r.code === "site_layout_plan");
    expect(layout).toHaveLength(1);
    expect(layout[0].label).toBe("Site layout plan (1:500, Fingal)");
  });

  it("adds the authority's extra requirements on top of the baseline", () => {
    const out = resolveRequirements(all, "Fingal County Council");
    expect(out.map((r) => r.code)).toEqual([
      "site_location_map",
      "site_layout_plan",
      "tree_survey",
    ]);
  });

  it("never leaks another authority's requirements", () => {
    const out = resolveRequirements(all, "Fingal County Council");
    expect(out.map((r) => r.code)).not.toContain("other_council_rule");
  });

  it("orders by sort_order, then code for a stable tie-break", () => {
    const out = resolveRequirements(
      [req("b", { sort_order: 5 }), req("a", { sort_order: 5 }), req("c", { sort_order: 1 })],
      null
    );
    expect(out.map((r) => r.code)).toEqual(["c", "a", "b"]);
  });
});

describe("buildChecklist — unknown beats satisfied", () => {
  const reqs = [
    req("site_location_map", { sort_order: 10 }),
    req("flood_risk", { mandatory: false, sort_order: 20 }),
  ];

  it("marks an attributed document as satisfied and names the evidence", () => {
    const items = buildChecklist(reqs, [doc("d1", "os-map.pdf", "site_location_map")]);
    expect(items[0].status).toBe("satisfied");
    expect(items[0].evidenceDocumentId).toBe("d1");
    expect(items[0].reason).toContain("os-map.pdf");
  });

  it("marks a mandatory item with nothing uploaded as missing", () => {
    const items = buildChecklist(reqs, []);
    expect(items[0].status).toBe("missing");
    expect(items[0].reason).toContain("required");
  });

  it("says an optional item is conditional rather than just absent", () => {
    const items = buildChecklist(reqs, []);
    expect(items[1].status).toBe("missing");
    expect(items[1].reason).toContain("if it applies");
  });

  it("NEVER guesses from a filename", () => {
    // "site-location-map.pdf" uploaded with no attribution is not evidence.
    // A false 'satisfied' here is the most expensive thing this product can
    // do: the applicant turns up without the document and loses weeks.
    const items = buildChecklist(reqs, [doc("d9", "site-location-map.pdf", null)]);
    expect(items[0].status).toBe("missing");
    expect(items[0].evidenceDocumentId).toBeNull();
  });

  it("flags AMBIGUITY rather than silently picking one document", () => {
    const items = buildChecklist(reqs, [
      doc("d1", "map-v1.pdf", "site_location_map"),
      doc("d2", "map-FINAL.pdf", "site_location_map"),
    ]);
    expect(items[0].status).toBe("unclear");
    expect(items[0].reason).toContain("confirm which one");
  });

  it("returns one item per requirement, in requirement order", () => {
    const items = buildChecklist(reqs, []);
    expect(items.map((i) => i.code)).toEqual(["site_location_map", "flood_risk"]);
  });
});

describe("summariseChecklist — 'ready to submit' has to mean it", () => {
  const reqs = [
    req("a", { sort_order: 10 }),
    req("b", { sort_order: 20 }),
    req("optional", { mandatory: false, sort_order: 30 }),
  ];

  it("is ready when every mandatory item is satisfied", () => {
    const items = buildChecklist(reqs, [
      doc("d1", "a.pdf", "a"),
      doc("d2", "b.pdf", "b"),
    ]);
    const s = summariseChecklist(items);
    expect(s.readyToSubmit).toBe(true);
    expect(s.missingMandatory).toBe(0);
  });

  it("an absent OPTIONAL item does not block ready", () => {
    // A flood risk assessment isn't required for an inland site. Blocking on it
    // would train the applicant to ignore this number entirely.
    const items = buildChecklist(reqs, [
      doc("d1", "a.pdf", "a"),
      doc("d2", "b.pdf", "b"),
    ]);
    expect(summariseChecklist(items).readyToSubmit).toBe(true);
  });

  it("is NOT ready while a mandatory item is missing", () => {
    const items = buildChecklist(reqs, [doc("d1", "a.pdf", "a")]);
    const s = summariseChecklist(items);
    expect(s.readyToSubmit).toBe(false);
    expect(s.missingMandatory).toBe(1);
  });

  it("is NOT ready while anything is unclear, even with nothing missing", () => {
    const items = buildChecklist(reqs, [
      doc("d1", "a1.pdf", "a"),
      doc("d2", "a2.pdf", "a"),
      doc("d3", "b.pdf", "b"),
    ]);
    const s = summariseChecklist(items);
    expect(s.unclear).toBe(1);
    expect(s.missingMandatory).toBe(0);
    expect(s.readyToSubmit).toBe(false);
  });

  it("counts what it says it counts", () => {
    const items = buildChecklist(reqs, [doc("d1", "a.pdf", "a")]);
    const s = summariseChecklist(items);
    expect(s.total).toBe(3);
    expect(s.satisfied).toBe(1);
    // The click-through has to match the count: 1 satisfied + 2 missing = 3.
    expect(items.filter((i) => i.status === "missing")).toHaveLength(2);
  });
});
