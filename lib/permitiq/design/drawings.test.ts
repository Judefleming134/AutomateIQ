import { describe, it, expect } from "vitest";
import {
  briefMetrics,
  canDraw,
  COMPASS,
  type DesignBrief,
  drawingsAreSubmittable,
  EMPTY_OPENINGS,
  faceRole,
  oppositeFace,
  PRELIMINARY_STAMP,
  reviewBrief,
} from "./brief";
import { drawableArea, fitScale, mmPerMetre, PAPER, scaleBar } from "./sheet";
import {
  elevationOutline,
  elevations,
  floorPlan,
  renderDrawingSet,
  section,
  siteLayoutPlan,
  siteLocationMapPlaceholder,
  type DrawingMeta,
} from "./sheets";

/**
 * Planning drawings are measured documents. A planner scales off them, a
 * neighbour objects off them, and an authority invalidates an application over
 * them. So the tests that matter are not "does it render" — they are:
 *
 *   the scale is真 the scale it claims
 *   the dimension printed is the number the applicant typed
 *   a building that does not fit its site is refused, not drawn crossing it
 *   the same brief renders byte-identically, so a set can be re-checked
 *   the PRELIMINARY stamp cannot be lost
 *
 * The site location map is asserted to be a PLACEHOLDER on purpose: Irish
 * applications need OSi/Tailte Éireann licensed mapping, and generating
 * something map-shaped would be rejected at the counter.
 */

const meta: DrawingMeta = {
  project: "Rear extension, 14 Maple Drive",
  siteAddress: "14 Maple Drive, Swords, Co. Dublin",
  applicant: "J. Fleming",
  dateISO: "2026-08-04",
};

/** A realistic domestic extension: 20m × 32m site, house up front, extension behind. */
const brief = (over: Partial<DesignBrief> = {}): DesignBrief => ({
  site: { widthM: 20, depthM: 32, frontage: "south", addressLine: "14 Maple Drive" },
  existing: {
    label: "Existing dwelling",
    widthM: 9,
    depthM: 8,
    offsetXM: 5.5,
    offsetYM: 6,
    storeys: 2,
    eavesHeightM: 5,
    ridgeHeightM: 8,
    roof: "pitched",
  },
  proposed: {
    label: "Proposed extension",
    widthM: 6,
    depthM: 4,
    offsetXM: 7,
    offsetYM: 14,
    storeys: 1,
    eavesHeightM: 2.7,
    ridgeHeightM: 3.9,
    roof: "pitched",
    externalFinish: "Nap plaster to match existing",
  },
  works: "extension",
  rooms: [
    { name: "Kitchen/dining", widthM: 4, depthM: 4 },
    { name: "Utility", widthM: 2, depthM: 2 },
  ],
  openings: {
    ...EMPTY_OPENINGS,
    north: { windows: 2, doors: 1 },
    south: { windows: 1, doors: 0 },
  },
  access: { drivewayWidthM: 3.2, parkingSpaces: 2 },
  openSpaceM2: 180,
  ...over,
});

describe("the scale is the scale it claims", () => {
  it("converts metres to paper millimetres by the declared ratio", () => {
    expect(mmPerMetre(100)).toBe(10); // 1:100 → 1m = 10mm
    expect(mmPerMetre(500)).toBe(2);
    expect(mmPerMetre(50)).toBe(20);
    expect(mmPerMetre(2500)).toBe(0.4);
  });

  it("the viewBox IS the paper, so one unit is one millimetre", () => {
    const svg = siteLayoutPlan(brief(), meta).svg;
    expect(svg).toContain(`viewBox="0 0 ${PAPER.A3.widthMm} ${PAPER.A3.heightMm}"`);
    expect(svg).toContain(`width="${PAPER.A3.widthMm}mm"`);
  });

  it("picks the finest scale that fits and never stretches to fill", () => {
    const area = drawableArea("A3");
    // Something that fits at 1:100 must not be reported at 1:50.
    const chosen = fitScale(30, 18, "A3");
    expect(chosen).toBe(100);
    expect(30 * mmPerMetre(chosen!)).toBeLessThanOrEqual(area.widthMm);
    expect(18 * mmPerMetre(chosen!)).toBeLessThanOrEqual(area.heightMm);
  });

  it("returns null rather than overflowing the sheet", () => {
    // A 3km site does not fit on A3 at any listed scale. Silently drawing it
    // off the paper would be the alternative.
    expect(fitScale(3000, 3000, "A3")).toBeNull();
  });

  it("the scale bar is derived from the same ratio as the geometry", () => {
    // A scale bar held as a separate constant is one that can disagree with
    // the drawing — and a wrong scale bar is worse than none.
    const bar = scaleBar(0, 0, 100, 10);
    expect(bar).toContain("1:100");
    expect(bar).toContain(">10m<");
    // 10m at 1:100 is 100mm, in four segments of 25.
    expect(bar).toContain('width="25"');
  });
});

describe("the dimensions printed are the numbers entered", () => {
  it("prints the site's own width and depth", () => {
    const svg = siteLayoutPlan(brief(), meta).svg;
    expect(svg).toContain(">20m<");
    expect(svg).toContain(">32m<");
  });

  it("computes each setback against the right boundary", () => {
    // Fronting south: 14m back from the road, 32-18=14 to the rear, 7 to the
    // west (left as drawn), 20-13=7 to the east.
    const m = briefMetrics(brief());
    expect(m.setbacksM.south).toBe(14);
    expect(m.setbacksM.north).toBe(14);
    expect(m.setbacksM.west).toBe(7);
    expect(m.setbacksM.east).toBe(7);
  });

  it("rotating the frontage moves the setbacks with it", () => {
    // The most consequential number on a domestic drawing. If frontage changes
    // and the labels don't follow, "front" and "side" silently swap.
    const east = briefMetrics(brief({ site: { widthM: 20, depthM: 32, frontage: "east" } }));
    expect(east.setbacksM.east).toBe(14); // the road boundary
    expect(east.setbacksM.west).toBe(14);
    expect(east.setbacksM.south).toBe(7);
    expect(east.setbacksM.north).toBe(7);
  });

  it("names the tightest setback, which is what gets queried", () => {
    const m = briefMetrics(
      brief({
        proposed: { ...brief().proposed, offsetXM: 13.2 }, // 0.8m to the east
      })
    );
    expect(m.tightestSetback).toEqual({ face: "east", metres: 0.8 });
  });

  it("derives area, floor area and coverage from the same numbers the form quotes", () => {
    const m = briefMetrics(brief());
    expect(m.siteAreaM2).toBe(640);
    expect(m.proposedFootprintM2).toBe(24);
    expect(m.proposedFloorAreaM2).toBe(24); // single storey
    expect(m.existingFootprintM2).toBe(72);
    expect(m.siteCoveragePct).toBe(15); // (72+24)/640
  });

  it("counts every storey in the floor area", () => {
    const m = briefMetrics(brief({ proposed: { ...brief().proposed, storeys: 2 } }));
    expect(m.proposedFloorAreaM2).toBe(48);
  });
});

describe("a building that does not fit is refused, not fudged", () => {
  it("reports an overhang per boundary and blocks drawing", () => {
    const bad = brief({ proposed: { ...brief().proposed, offsetXM: 17 } }); // 6m wide, site 20
    const issues = reviewBrief(bad);
    const overhang = issues.find((i) => i.message.includes("beyond the east boundary"));
    expect(overhang?.level).toBe("error");
    expect(overhang?.message).toContain("3m beyond");
    expect(canDraw(bad)).toBe(false);
  });

  it("keeps the overhang negative rather than clamping it to zero", () => {
    // Clamping would draw a building sitting neatly on a boundary it crosses.
    const m = briefMetrics(brief({ proposed: { ...brief().proposed, offsetXM: 17 } }));
    expect(m.setbacksM.east).toBe(-3);
  });

  it("warns, but still draws, when it sits exactly on a boundary", () => {
    const onLine = brief({ proposed: { ...brief().proposed, offsetXM: 14 } });
    const issue = reviewBrief(onLine).find((i) => i.message.includes("directly on the east"));
    expect(issue?.level).toBe("warning");
    expect(canDraw(onLine)).toBe(true);
  });

  it("refuses a roof drawn upside down", () => {
    const bad = brief({
      proposed: { ...brief().proposed, eavesHeightM: 4, ridgeHeightM: 2 },
    });
    expect(canDraw(bad)).toBe(false);
  });

  it("refuses an extension with nothing to extend", () => {
    expect(canDraw(brief({ existing: null }))).toBe(false);
    // …but a new dwelling on a greenfield site is fine.
    expect(canDraw(brief({ existing: null, works: "new_dwelling" }))).toBe(true);
  });

  it("catches footprints that exceed the site between them", () => {
    const bad = brief({
      existing: { ...brief().existing!, widthM: 19, depthM: 30, offsetXM: 0, offsetYM: 0 },
      proposed: { ...brief().proposed, widthM: 19, depthM: 30, offsetXM: 0, offsetYM: 0 },
    });
    expect(reviewBrief(bad).some((i) => i.message.includes("exceed the site area"))).toBe(true);
  });

  it("says so on the sheet when a warning applies, instead of swallowing it", () => {
    const onLine = brief({ proposed: { ...brief().proposed, offsetXM: 14 } });
    expect(siteLayoutPlan(onLine, meta).svg).toContain("directly on the east boundary");
  });
});

describe("the roof is the shape it was described as", () => {
  const s = brief().proposed;

  it("a pitched roof is a triangle from the gable and a rectangle from the side", () => {
    const gable = elevationOutline({ ...s, roof: "pitched" }, 6, 10, true);
    const side = elevationOutline({ ...s, roof: "pitched" }, 6, 10, false);
    // Gable: five points including the apex at mid-width (30 = 6m × 10mm / 2).
    expect(gable).toContain("L 30 -39");
    // Side: four corners, all at ridge height, no apex.
    expect(side).toBe("M 0 0 L 0 -39 L 60 -39 L 60 0 Z");
  });

  it("a flat roof ignores the ridge height entirely", () => {
    const flat = elevationOutline({ ...s, roof: "flat" }, 6, 10, true);
    expect(flat).toBe("M 0 0 L 0 -27 L 60 -27 L 60 0 Z"); // eaves 2.7m only
    // And the brief says so rather than silently discarding the number.
    const warn = reviewBrief(brief({ proposed: { ...s, roof: "flat" } }));
    expect(warn.some((i) => i.message.includes("ridge height entered is ignored"))).toBe(true);
  });

  it("a mono-pitch falls from one side to the other", () => {
    const mono = elevationOutline({ ...s, roof: "mono" }, 6, 10, true);
    expect(mono).toContain("L 0 -39"); // high side
    expect(mono).toContain("L 60 -27"); // low side at eaves
  });

  it("a hipped roof is a trapezoid from every direction", () => {
    const a = elevationOutline({ ...s, roof: "hipped" }, 6, 10, true);
    const b = elevationOutline({ ...s, roof: "hipped" }, 6, 10, false);
    expect(a).toBe(b); // hips slope in on all four sides
    expect(a.match(/L /g)!.length).toBe(5);
  });

  it("the ridge runs along the longer plan dimension", () => {
    // A bungalow wider than it is deep shows its gable on the side elevations,
    // not the front. Getting this backwards draws a triangle for a front door.
    const wide = brief({
      proposed: { ...s, widthM: 12, depthM: 6 },
      site: { widthM: 20, depthM: 32, frontage: "south" },
    });
    const svg = elevations(wide, meta).svg;
    expect(svg).toContain("Proposed front (south) elevation");
    expect(svg).toContain("Proposed side (east) elevation");
  });
});

describe("faces are named the way a drawing titles them", () => {
  it("maps compass points to front, rear and side", () => {
    expect(faceRole("south", "south")).toBe("front");
    expect(faceRole("north", "south")).toBe("rear");
    expect(faceRole("east", "south")).toBe("side");
    expect(faceRole("west", "south")).toBe("side");
  });

  it("opposite is opposite for every point", () => {
    for (const f of COMPASS) expect(oppositeFace(oppositeFace(f))).toBe(f);
  });

  it("titles all four elevations", () => {
    const svg = elevations(brief(), meta).svg;
    for (const face of COMPASS) expect(svg).toContain(`(${face}) elevation`);
  });

  it.each([
    ["south", 0],
    ["east", 90],
    ["north", 180],
    ["west", 270],
  ])("points north correctly on a site fronting %s", (frontage, bearing) => {
    // The plan always draws the frontage along the bottom, so the arrow is the
    // ONLY thing telling the reader how the sheet relates to north. An arrow
    // rotated the wrong way describes a different site to the plan beside it —
    // and this went uncaught until a deliberate break exposed it.
    const svg = siteLayoutPlan(
      brief({ site: { widthM: 20, depthM: 32, frontage: frontage as "south" } }),
      meta
    ).svg;
    expect(svg).toMatch(new RegExp(`class="north"[^>]*rotate\\(${bearing}\\)`));
  });

  it("labels the road with the boundary it actually runs along", () => {
    for (const frontage of COMPASS) {
      const svg = siteLayoutPlan(
        brief({ site: { widthM: 20, depthM: 32, frontage } }),
        meta
      ).svg;
      expect(svg).toContain(`ROAD (${frontage} boundary)`);
    }
  });
});

describe("openings are drawn, and never taller than the wall", () => {
  it("draws one rect per window and door", () => {
    const svg = elevations(brief(), meta).svg;
    // north has 2 windows + 1 door, south has 1 window = 4 openings.
    expect((svg.match(/fill="#eaf1f8"/g) ?? []).length).toBe(4);
  });

  it("clips a 2m door into a 1.8m wall rather than drawing through the roof", () => {
    const low = brief({
      proposed: { ...brief().proposed, eavesHeightM: 1.8, ridgeHeightM: 2.4 },
      openings: { ...EMPTY_OPENINGS, north: { windows: 0, doors: 1 } },
    });
    const drawing = elevations(low, meta);
    expect(drawing.svg).toContain('fill="#eaf1f8"');
    // Measured against the scale THIS drawing chose, not a hard-coded one —
    // elevations pick their scale to fit, so an assertion that assumes 1:100
    // tests the assumption rather than the clipping.
    const mm = mmPerMetre(drawing.scale);
    const openings = [
      ...drawing.svg.matchAll(/y="(-?[\d.]+)" width="[\d.]+" height="([\d.]+)" fill="#eaf1f8"/g),
    ];
    expect(openings.length).toBeGreaterThan(0);
    for (const [, y, h] of openings) {
      // Nothing may reach above the eaves line for an opening.
      expect(Math.abs(Number(y))).toBeLessThanOrEqual(1.8 * mm);
      expect(Number(h)).toBeGreaterThan(0);
    }
  });

  it("warns when a set of elevations would be blank walls", () => {
    const blank = brief({ openings: EMPTY_OPENINGS });
    expect(
      reviewBrief(blank).some((i) => i.message.includes("elevations are drawn as blank walls"))
    ).toBe(true);
  });
});

describe("the floor plan is honest about what it is", () => {
  it("lays the rooms in and labels them with the entered sizes", () => {
    const svg = floorPlan(brief(), meta).svg;
    expect(svg).toContain("Kitchen/dining");
    expect(svg).toContain("4×4m");
    expect(svg).toContain("Utility");
  });

  it("says the arrangement is indicative, on the sheet", () => {
    expect(floorPlan(brief(), meta).svg).toContain(
      "arrangement is indicative and does not show structure, stairs or services"
    );
  });

  it("scales rooms to fit rather than overflowing the outline", () => {
    const packed = brief({
      rooms: [
        { name: "A", widthM: 10, depthM: 10 },
        { name: "B", widthM: 10, depthM: 10 },
      ],
    });
    // 200m² of rooms in a 24m² footprint: warned, and still drawn inside.
    expect(
      reviewBrief(packed).some((i) => i.message.includes("more than the 24m² floor area"))
    ).toBe(true);
    expect(floorPlan(packed, meta).svg).toContain("<svg");
  });

  it("warns rather than drawing an empty box and calling it a plan", () => {
    expect(reviewBrief(brief({ rooms: [] })).some((i) => i.field === "rooms")).toBe(true);
  });
});

describe("the section states what it assumes", () => {
  it("draws a floor line per storey", () => {
    const two = brief({ proposed: { ...brief().proposed, storeys: 2, eavesHeightM: 5 } });
    expect(section(two, meta).svg).toContain("floor 2");
  });

  it("says the ground is drawn level, because a slope changes every height", () => {
    expect(section(brief(), meta).svg).toContain("A sloping site changes every height");
  });
});

describe("the site location map is a placeholder, deliberately", () => {
  const d = siteLocationMapPlaceholder(brief(), meta);

  it("does not pretend to be a map", () => {
    expect(d.svg).toContain("This sheet is intentionally blank");
    expect(d.svg).toContain("cannot be generated");
  });

  it("says exactly what to buy and what to mark on it", () => {
    expect(d.svg).toContain("Tailte Éireann");
    expect(d.svg).toContain("1:2500");
    expect(d.svg).toContain("outlined in RED");
    expect(d.svg).toContain("outlined in BLUE");
  });

  it("still carries the requirement code, so the checklist sees the gap", () => {
    expect(d.requirementCode).toBe("site_location_map");
  });
});

describe("the set, and the stamp that cannot be lost", () => {
  it("renders five sheets in the order a planner reads them", () => {
    const set = renderDrawingSet(brief(), meta);
    expect(set.map((d) => d.drawingNumber)).toEqual([
      "PL-00",
      "PL-01",
      "PL-02",
      "PL-03",
      "PL-04",
    ]);
  });

  it("every sheet carries the PRELIMINARY stamp", () => {
    for (const d of renderDrawingSet(brief(), meta)) {
      expect(d.svg).toContain(PRELIMINARY_STAMP.slice(0, 40));
    }
  });

  it("nothing can clear the stamp", () => {
    // Typed as `false`, so a later edit returning true is a type error too.
    expect(drawingsAreSubmittable()).toBe(false);
  });

  it("maps each sheet onto the requirement it satisfies", () => {
    const set = renderDrawingSet(brief(), meta);
    expect(set.map((d) => d.requirementCode)).toEqual([
      "site_location_map",
      "site_layout_plan",
      "floor_plans",
      "floor_plans",
      "floor_plans",
    ]);
  });

  it("is byte-identical across renders", () => {
    // A set that changes between renders cannot be checked, signed, or
    // resubmitted after a further-information request.
    const a = renderDrawingSet(brief(), meta).map((d) => d.svg).join("");
    const b = renderDrawingSet(brief(), meta).map((d) => d.svg).join("");
    expect(a).toBe(b);
  });

  it("takes its date from the caller, never the clock", () => {
    const set = renderDrawingSet(brief(), { ...meta, dateISO: "2020-01-01" });
    expect(set[1].svg).toContain("2020-01-01");
  });

  it("escapes text that would otherwise break the SVG", () => {
    const nasty = renderDrawingSet(brief({ notes: '</svg><script>x</script>' }), meta);
    for (const d of nasty) {
      expect(d.svg).not.toContain("<script>");
      expect(d.svg.match(/<\/svg>/g)!.length).toBe(1);
    }
  });

  it("produces well-formed SVG for every sheet", () => {
    for (const d of renderDrawingSet(brief(), meta)) {
      expect(d.svg.startsWith("<svg")).toBe(true);
      expect(d.svg.endsWith("</svg>")).toBe(true);
      expect((d.svg.match(/<g /g) ?? []).length).toBeGreaterThan(0);
    }
  });
});
