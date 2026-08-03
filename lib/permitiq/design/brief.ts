/**
 * The design brief: what the questionnaire captures, and what the drawings are
 * drawn from.
 *
 * EVERY DIMENSION IS METRES, and every number here is one the applicant typed.
 * That is the whole design principle. Planning drawings are measured documents
 * — a planner scales off them and a neighbour objects off them — so nothing in
 * this pipeline may invent a dimension, round one for tidiness, or infer one
 * from a photograph. If a number isn't in the brief, the drawing says so on its
 * face rather than guessing.
 *
 * Which is also why the geometry is pure and deterministic and no model is
 * anywhere near it. The same brief must produce a byte-identical drawing every
 * time: a set of drawings that changes between renders can't be checked, can't
 * be signed, and can't be resubmitted after a further-information request.
 *
 * WHAT THIS IS NOT. These are preliminary drawings. A planning application in
 * Ireland is normally prepared by a competent person, and a drawing generated
 * from a questionnaire has not been on site, has not seen a level survey, and
 * does not know where the sewer runs. Every sheet carries a PRELIMINARY stamp
 * for that reason, and `drawingsAreSubmittable` below is deliberately the only
 * thing that can clear it.
 */

/** What is being applied for. Drives the sheets, the notices and the fee. */
export type WorksType =
  | "extension"
  | "new_dwelling"
  | "garage_outbuilding"
  | "conversion"
  | "change_of_use"
  | "demolition_and_rebuild";

export const WORKS_LABELS: Record<WorksType, string> = {
  extension: "Extension to existing dwelling",
  new_dwelling: "New dwelling",
  garage_outbuilding: "Garage / outbuilding",
  conversion: "Conversion (e.g. attic, garage)",
  change_of_use: "Change of use",
  demolition_and_rebuild: "Demolition and rebuild",
};

export type RoofType = "pitched" | "hipped" | "flat" | "mono";

export const ROOF_LABELS: Record<RoofType, string> = {
  pitched: "Pitched (gable each end)",
  hipped: "Hipped",
  flat: "Flat",
  mono: "Mono-pitch / lean-to",
};

/** Which way the site fronts the road. Fixes which elevation is "front". */
export type Frontage = "north" | "east" | "south" | "west";

/**
 * A building on the site, as a rectangle.
 *
 * A rectangle and not a polygon on purpose: it is what a homeowner can answer
 * accurately with a tape measure, and an L-shape entered wrongly is worse than
 * a rectangle entered right. `notes` carries the shape the geometry can't —
 * it prints on the sheet so the architect sees what the applicant meant.
 */
export type Structure = {
  label: string;
  widthM: number;
  depthM: number;
  /** Front-left corner, measured from the site's front-left corner. */
  offsetXM: number;
  offsetYM: number;
  storeys: number;
  /** Wall height to the eaves. */
  eavesHeightM: number;
  /** Height to the ridge. Equals eaves for a flat roof. */
  ridgeHeightM: number;
  roof: RoofType;
  /** External finish, printed on the elevations — planners ask. */
  externalFinish?: string;
  notes?: string;
};

/** A room in the proposed works, for the floor plan. */
export type Room = {
  name: string;
  widthM: number;
  depthM: number;
};

/** Openings on one face, so the elevations aren't blank rectangles. */
export type FaceOpenings = {
  windows: number;
  doors: number;
};

export type Openings = Record<Frontage, FaceOpenings>;

export type DesignBrief = {
  site: {
    /** Boundary width along the road frontage. */
    widthM: number;
    depthM: number;
    /** Which boundary meets the road. */
    frontage: Frontage;
    addressLine?: string;
  };
  /** Null on a greenfield site — a new dwelling with nothing there yet. */
  existing: Structure | null;
  proposed: Structure;
  works: WorksType;
  rooms: Room[];
  openings: Openings;
  access: {
    drivewayWidthM: number;
    parkingSpaces: number;
  };
  /** Private open space retained, in square metres. Planners test this. */
  openSpaceM2: number;
  /** Free text the applicant added; printed, never interpreted. */
  notes?: string;
};

export const EMPTY_OPENINGS: Openings = {
  north: { windows: 0, doors: 0 },
  east: { windows: 0, doors: 0 },
  south: { windows: 0, doors: 0 },
  west: { windows: 0, doors: 0 },
};

/** The compass, clockwise from north — used to walk faces in order. */
export const COMPASS: Frontage[] = ["north", "east", "south", "west"];

/** The face opposite a given one. */
export function oppositeFace(f: Frontage): Frontage {
  return COMPASS[(COMPASS.indexOf(f) + 2) % 4];
}

/**
 * Names each face by its role rather than its compass point, because that is
 * how a planning drawing is titled: "Proposed front (south) elevation".
 */
export function faceRole(
  face: Frontage,
  frontage: Frontage
): "front" | "rear" | "side" {
  if (face === frontage) return "front";
  if (face === oppositeFace(frontage)) return "rear";
  return "side";
}

/**
 * Everything the drawings and the form both need computed, in one place so the
 * two can never disagree. A site layout showing one floor area and an
 * application form declaring another is the kind of contradiction that gets an
 * application invalidated.
 */
export type BriefMetrics = {
  siteAreaM2: number;
  existingFootprintM2: number;
  proposedFootprintM2: number;
  /** Gross floor area of the PROPOSED works — footprint × storeys. */
  proposedFloorAreaM2: number;
  /** Total built footprint as a share of the site. */
  siteCoveragePct: number;
  /** Distance from the proposed structure to each boundary. */
  setbacksM: Record<Frontage, number>;
  /** Smallest setback, and to which boundary. */
  tightestSetback: { face: Frontage; metres: number };
  openSpaceM2: number;
};

/** Rounds to one decimal — the precision a tape measure actually gives. */
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Derives every measurement the sheets and the form quote.
 *
 * Setbacks are computed in SITE coordinates (x across the frontage, y back
 * from the road) and then mapped onto compass faces, so rotating which
 * boundary meets the road cannot silently swap "front" and "side" distances —
 * the single most consequential number on a domestic planning drawing.
 */
export function briefMetrics(brief: DesignBrief): BriefMetrics {
  const { site, existing, proposed } = brief;
  const siteAreaM2 = site.widthM * site.depthM;
  const existingFootprintM2 = existing ? existing.widthM * existing.depthM : 0;
  const proposedFootprintM2 = proposed.widthM * proposed.depthM;

  // Site-space gaps: how much clear ground is left on each side of the
  // proposed structure. Negative means it does not fit — kept negative rather
  // than clamped, because a drawing that quietly clamps an overhang to zero
  // shows a building sitting neatly on a boundary it actually crosses.
  const gapFront = proposed.offsetYM;
  const gapRear = site.depthM - (proposed.offsetYM + proposed.depthM);
  const gapLeft = proposed.offsetXM;
  const gapRight = site.widthM - (proposed.offsetXM + proposed.widthM);

  // Map site-space onto the compass.
  //
  // The plan is drawn with the road frontage along the BOTTOM of the sheet, so
  // page-down is the frontage direction and page-up is its opposite. Site x
  // increases to the right of the page, which means the right-hand boundary is
  // the face 90° ANTICLOCKWISE of the frontage on the compass — not clockwise.
  //
  // Worth spelling out because the clockwise version is the intuitive one and
  // it is wrong: fronting south it puts the west boundary on the right of a
  // sheet where north is up. Every side setback would be labelled with the
  // opposite neighbour's boundary, which on a domestic application is the
  // number the whole thing turns on.
  const front = site.frontage;
  const i = COMPASS.indexOf(front);
  const right = COMPASS[(i + 3) % 4];
  const rear = oppositeFace(front);
  const left = COMPASS[(i + 1) % 4];

  const setbacksM = {
    [front]: round1(gapFront),
    [right]: round1(gapRight),
    [rear]: round1(gapRear),
    [left]: round1(gapLeft),
  } as Record<Frontage, number>;

  let tightestSetback = { face: front, metres: setbacksM[front] };
  for (const face of COMPASS) {
    if (setbacksM[face] < tightestSetback.metres) {
      tightestSetback = { face, metres: setbacksM[face] };
    }
  }

  return {
    siteAreaM2: round1(siteAreaM2),
    existingFootprintM2: round1(existingFootprintM2),
    proposedFootprintM2: round1(proposedFootprintM2),
    proposedFloorAreaM2: round1(proposedFootprintM2 * Math.max(1, proposed.storeys)),
    siteCoveragePct:
      siteAreaM2 > 0
        ? round1(((existingFootprintM2 + proposedFootprintM2) / siteAreaM2) * 100)
        : 0,
    setbacksM,
    tightestSetback,
    openSpaceM2: round1(brief.openSpaceM2),
  };
}

/** A problem found in the brief itself. */
export type BriefIssue = {
  /** `error` blocks drawing; `warning` draws, but says so on the sheet. */
  level: "error" | "warning";
  field: string;
  message: string;
};

/**
 * Checks the brief before anything is drawn.
 *
 * The split matters. An ERROR is geometry that cannot be rendered honestly —
 * a building wider than its site would have to be drawn crossing the boundary
 * or silently shrunk, and both are worse than refusing. A WARNING is geometry
 * that is legal to draw but that a planner will ask about, so it is printed on
 * the sheet where the applicant and their architect will both see it, rather
 * than swallowed.
 *
 * Nothing here is a planning judgement. "This breaches a standard" is not
 * something this code is entitled to say — development plan standards vary by
 * authority and by zoning. It says what the drawing shows and lets a competent
 * person rule on it.
 */
export function reviewBrief(brief: DesignBrief): BriefIssue[] {
  const issues: BriefIssue[] = [];
  const { site, proposed, existing } = brief;
  const m = briefMetrics(brief);

  const positive = (v: number, field: string, label: string) => {
    if (!Number.isFinite(v) || v <= 0) {
      issues.push({ level: "error", field, message: `${label} must be greater than zero.` });
    }
  };
  positive(site.widthM, "site.widthM", "Site width");
  positive(site.depthM, "site.depthM", "Site depth");
  positive(proposed.widthM, "proposed.widthM", "Proposed width");
  positive(proposed.depthM, "proposed.depthM", "Proposed depth");

  if (proposed.ridgeHeightM < proposed.eavesHeightM) {
    issues.push({
      level: "error",
      field: "proposed.ridgeHeightM",
      message: "Ridge height is below eaves height — the roof would be drawn upside down.",
    });
  }
  if (proposed.roof === "flat" && proposed.ridgeHeightM !== proposed.eavesHeightM) {
    issues.push({
      level: "warning",
      field: "proposed.roof",
      message:
        "A flat roof is drawn with the ridge at eaves level; the ridge height entered is ignored on the elevations.",
    });
  }

  // Does it fit? Reported per boundary so the applicant knows WHICH side.
  for (const face of COMPASS) {
    const gap = m.setbacksM[face];
    if (gap < 0) {
      issues.push({
        level: "error",
        field: "proposed.offset",
        message: `The proposed structure extends ${Math.abs(gap)}m beyond the ${face} boundary. Check its position on the site.`,
      });
    } else if (gap === 0) {
      issues.push({
        level: "warning",
        field: "proposed.offset",
        message: `The proposed structure sits directly on the ${face} boundary. Building to a boundary usually needs the neighbour's agreement and is often queried.`,
      });
    }
  }

  if (existing && m.siteCoveragePct > 100) {
    issues.push({
      level: "error",
      field: "existing",
      message:
        "Existing and proposed footprints together exceed the site area — one of the three is wrong.",
    });
  }

  if (brief.works === "extension" && !existing) {
    issues.push({
      level: "error",
      field: "existing",
      message: "An extension needs an existing structure to extend. Add the existing building.",
    });
  }

  // The rooms are what the floor plan is built from. Silence here would draw
  // an empty rectangle and call it a floor plan.
  if (brief.rooms.length === 0) {
    issues.push({
      level: "warning",
      field: "rooms",
      message:
        "No rooms listed, so the floor plan shows the outline only. Add rooms for an internal layout.",
    });
  } else {
    const roomArea = brief.rooms.reduce((a, r) => a + r.widthM * r.depthM, 0);
    if (roomArea > m.proposedFootprintM2 * Math.max(1, proposed.storeys) * 1.05) {
      issues.push({
        level: "warning",
        field: "rooms",
        message: `The rooms listed total ${Math.round(roomArea)}m², more than the ${m.proposedFloorAreaM2}m² floor area entered. The plan shows them scaled to fit.`,
      });
    }
  }

  const totalOpenings = COMPASS.reduce(
    (a, f) => a + brief.openings[f].windows + brief.openings[f].doors,
    0
  );
  if (totalOpenings === 0) {
    issues.push({
      level: "warning",
      field: "openings",
      message:
        "No windows or doors entered, so the elevations are drawn as blank walls. Planners read elevations for overlooking — add the openings.",
    });
  }

  return issues;
}

/** True when nothing blocks rendering. Warnings still draw. */
export function canDraw(brief: DesignBrief): boolean {
  return !reviewBrief(brief).some((i) => i.level === "error");
}

/**
 * Whether the drawings may lose the PRELIMINARY stamp.
 *
 * It is a hard `false`, and that is the point rather than an oversight. These
 * drawings are generated from a form; nothing in this codebase has been on the
 * site. Clearing the stamp is a judgement only the competent person who signs
 * the application can make, and it belongs in whatever tool they sign with —
 * not in a default that could drift to `true` in a later edit.
 */
export function drawingsAreSubmittable(): false {
  return false;
}

export const PRELIMINARY_STAMP =
  "PRELIMINARY — generated from the applicant's answers. Not surveyed. To be checked, corrected and signed by a competent person before submission.";
