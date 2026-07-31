import { describe, it, expect } from "vitest";
import {
  normaliseAnalysis,
  isAnalysableType,
} from "@/lib/permitiq/document-intelligence";

/**
 * The guard rail between a model's output and a ticked box.
 *
 * buildChecklist() turns an attribution into "satisfied". So a hallucinated or
 * half-confident requirement code doesn't just produce a bad label — it tells
 * an applicant a box is ticked when it isn't, and they find out at the council
 * counter. Two independent refusals apply, and both must pass before an
 * attribution is accepted.
 */

const ALLOWED = ["site_location_map", "site_layout_plan", "floor_plans"];

describe("normaliseAnalysis", () => {
  it("accepts a valid, high-confidence attribution", () => {
    const out = normaliseAnalysis(
      {
        requirement_code: "site_layout_plan",
        summary: "A 1:500 site layout showing boundaries and the proposed extension.",
        issues: [],
        confidence: "high",
      },
      ALLOWED
    );
    expect(out.requirementCode).toBe("site_layout_plan");
    expect(out.confidence).toBe("high");
  });

  it("REFUSES a code that isn't in the allowed list", () => {
    // The model inventing "environmental_impact_report" would otherwise tick a
    // requirement nobody asked for.
    const out = normaliseAnalysis(
      {
        requirement_code: "environmental_impact_report",
        summary: "A report.",
        issues: [],
        confidence: "high",
      },
      ALLOWED
    );
    expect(out.requirementCode).toBeNull();
  });

  it.each(["medium", "low"])(
    "REFUSES an in-list code the model is only %s confident about",
    (confidence) => {
      const out = normaliseAnalysis(
        {
          requirement_code: "floor_plans",
          summary: "Might be floor plans.",
          issues: [],
          confidence,
        },
        ALLOWED
      );
      // A coin flip renders identically to a certainty once it reaches the
      // checklist, so anything short of high stays unattributed.
      expect(out.requirementCode).toBeNull();
      expect(out.confidence).toBe(confidence);
    }
  );

  it("keeps the summary and issues even when the attribution is refused", () => {
    // The reading is still useful to a human — only the automatic tick is
    // withheld.
    const out = normaliseAnalysis(
      {
        requirement_code: "made_up_code",
        summary: "A drawing with no scale bar.",
        issues: ["No scale bar", "No north arrow"],
        confidence: "high",
      },
      ALLOWED
    );
    expect(out.requirementCode).toBeNull();
    expect(out.summary).toBe("A drawing with no scale bar.");
    expect(out.issues).toEqual(["No scale bar", "No north arrow"]);
  });

  it("survives junk without throwing", () => {
    for (const junk of [null, undefined, {}, { requirement_code: 42 }, []]) {
      const out = normaliseAnalysis(junk, ALLOWED);
      expect(out.requirementCode).toBeNull();
      expect(out.confidence).toBe("low");
      expect(Array.isArray(out.issues)).toBe(true);
    }
  });

  it("defaults an unrecognised confidence to low, not high", () => {
    const out = normaliseAnalysis(
      { requirement_code: "floor_plans", summary: "x", issues: [], confidence: "certain" },
      ALLOWED
    );
    expect(out.confidence).toBe("low");
    expect(out.requirementCode).toBeNull();
  });

  it("drops empty issue strings and caps the list", () => {
    const out = normaliseAnalysis(
      {
        requirement_code: null,
        summary: "x",
        issues: ["real problem", "", "   ", 7, ...Array(15).fill("more")],
        confidence: "low",
      },
      ALLOWED
    );
    expect(out.issues.length).toBeLessThanOrEqual(10);
    expect(out.issues).not.toContain("");
    expect(out.issues[0]).toBe("real problem");
  });

  it("never returns an empty summary", () => {
    expect(normaliseAnalysis({ summary: "   " }, ALLOWED).summary.length).toBeGreaterThan(0);
  });
});

describe("isAnalysableType", () => {
  it.each(["application/pdf", "image/jpeg", "image/png", "image/webp"])(
    "accepts %s",
    (t) => expect(isAnalysableType(t)).toBe(true)
  );

  it.each(["application/vnd.dwg", "text/plain", "application/zip", "", null, undefined])(
    "rejects %p rather than sending it to the model",
    (t) => expect(isAnalysableType(t as string | null)).toBe(false)
  );

  it("is case-insensitive, because browsers are inconsistent", () => {
    expect(isAnalysableType("APPLICATION/PDF")).toBe(true);
  });
});
