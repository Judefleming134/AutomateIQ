/**
 * The drawings themselves: site layout, floor plan, elevations, section.
 *
 * All pure. `renderDrawingSet(brief, meta)` with the same inputs returns the
 * same strings, every time — see brief.ts for why that is non-negotiable.
 *
 * WHAT IS DELIBERATELY NOT HERE: the site location map. An Irish planning
 * application needs one based on Ordnance Survey / Tailte Éireann mapping,
 * which is licensed and bought per application. It cannot be generated, and
 * `siteLocationMapPlaceholder` below is a sheet that says so in the applicant's
 * own words rather than an empty slot they discover at the counter.
 */

import {
  COMPASS,
  type DesignBrief,
  type Frontage,
  type Structure,
  briefMetrics,
  faceRole,
  reviewBrief,
  WORKS_LABELS,
} from "./brief";
import {
  dim,
  dimensionLine,
  drawableArea,
  escapeSvgText as esc,
  fitScale,
  mmPerMetre,
  northArrow,
  type PaperSize,
  type Scale,
  scaleBar,
  sheet,
  type TitleBlock,
} from "./sheet";

export type DrawingMeta = {
  project: string;
  siteAddress?: string;
  applicant?: string;
  /** Passed in, never `new Date()`, so a re-render is byte-identical. */
  dateISO: string;
};

export type Drawing = {
  /** Requirement code this satisfies, or null when it's supporting only. */
  requirementCode: "site_layout_plan" | "floor_plans" | "site_location_map" | null;
  key: string;
  title: string;
  drawingNumber: string;
  scale: Scale;
  paper: PaperSize;
  svg: string;
};

/** Compass bearing of "up the page" once the frontage is along the bottom. */
const NORTH_BEARING: Record<Frontage, number> = {
  // The frontage is drawn along the BOTTOM, so page-down is the frontage
  // direction and page-up is its opposite. The arrow then points wherever
  // north has ended up:
  //
  //   fronts south → up is north  →   0°
  //   fronts north → up is south  → 180°
  //   fronts east  → up is west,  north is to the RIGHT  →  90°
  //   fronts west  → up is east,  north is to the LEFT   → 270°
  //
  // East and west were the wrong way round here, which put north on the
  // opposite side of a sheet whose frontage was already correct — the arrow
  // and the plan describing two different sites.
  south: 0,
  east: 90,
  north: 180,
  west: 270,
};

/**
 * The roof outline of a structure seen from one face, as an SVG path in paper
 * millimetres, with (0,0) at the bottom-left of the wall.
 *
 * The four roof types differ only here, which is why they are one function:
 * a pitched roof seen from the gable end is a triangle and from the side is a
 * rectangle, and getting that backwards is the single easiest way to draw a
 * building nobody recognises.
 */
export function elevationOutline(
  s: Structure,
  faceWidthM: number,
  mm: number,
  /** True when looking at the gable end (the ridge runs away from you). */
  gableEnd: boolean
): string {
  const w = faceWidthM * mm;
  const eaves = s.eavesHeightM * mm;
  const ridge = (s.roof === "flat" ? s.eavesHeightM : s.ridgeHeightM) * mm;

  if (s.roof === "flat") {
    return `M 0 0 L 0 ${dim(-eaves)} L ${dim(w)} ${dim(-eaves)} L ${dim(w)} 0 Z`;
  }
  if (s.roof === "mono") {
    // Lean-to: high at the left, falling to eaves at the right.
    return `M 0 0 L 0 ${dim(-ridge)} L ${dim(w)} ${dim(-eaves)} L ${dim(w)} 0 Z`;
  }
  if (s.roof === "hipped") {
    // Hips slope in from every side, so both views show a trapezoid.
    const inset = Math.min(w * 0.25, (ridge - eaves) * 1.2);
    return (
      `M 0 0 L 0 ${dim(-eaves)} L ${dim(inset)} ${dim(-ridge)} ` +
      `L ${dim(w - inset)} ${dim(-ridge)} L ${dim(w)} ${dim(-eaves)} L ${dim(w)} 0 Z`
    );
  }
  // Pitched: a triangle from the gable end, a plain rectangle from the side.
  return gableEnd
    ? `M 0 0 L 0 ${dim(-eaves)} L ${dim(w / 2)} ${dim(-ridge)} L ${dim(w)} ${dim(-eaves)} L ${dim(w)} 0 Z`
    : `M 0 0 L 0 ${dim(-ridge)} L ${dim(w)} ${dim(-ridge)} L ${dim(w)} 0 Z`;
}

/** Windows and doors spread evenly along a wall, so elevations aren't blank. */
function openingsOnFace(
  count: { windows: number; doors: number },
  faceWidthM: number,
  mm: number,
  eavesHeightM: number
): string {
  const total = count.windows + count.doors;
  if (total === 0) return "";
  const w = faceWidthM * mm;
  const slot = w / (total + 1);
  let out = "";
  for (let i = 0; i < total; i++) {
    const isDoor = i >= count.windows;
    const cx = slot * (i + 1);
    // Nominal sizes: 1.2m × 1.2m window at 1m sill, 0.9m × 2.0m door.
    const ow = (isDoor ? 0.9 : 1.2) * mm;
    const oh = (isDoor ? 2.0 : 1.2) * mm;
    const sill = isDoor ? 0 : 1.0 * mm;
    // Never draw an opening taller than the wall it sits in.
    const capped = Math.min(oh, eavesHeightM * mm - sill - 0.1 * mm);
    if (capped <= 0) continue;
    out += `<rect x="${dim(cx - ow / 2)}" y="${dim(-sill - capped)}" width="${dim(ow)}" height="${dim(capped)}" fill="#eaf1f8" stroke="#333" stroke-width="0.25"/>`;
  }
  return out;
}

const footnotesFor = (brief: DesignBrief): string[] => {
  const notes = reviewBrief(brief)
    .filter((i) => i.level === "warning")
    .map((i) => `• ${i.message}`);
  if (brief.notes) notes.push(`• Applicant's note: ${brief.notes}`);
  return notes;
};

const titleFor = (
  meta: DrawingMeta,
  drawingTitle: string,
  drawingNumber: string,
  scale: Scale,
  paper: PaperSize
): TitleBlock => ({
  project: meta.project,
  drawingTitle,
  scale,
  paper,
  siteAddress: meta.siteAddress,
  applicant: meta.applicant,
  drawingNumber,
  dateISO: meta.dateISO,
});

/**
 * SITE LAYOUT PLAN — the sheet the planner reads first.
 *
 * Site boundary, the existing structure, the proposed structure, and every
 * setback dimensioned. Drawn in site coordinates with the road frontage along
 * the bottom, and the north arrow rotated to suit — see NORTH_BEARING.
 */
export function siteLayoutPlan(brief: DesignBrief, meta: DrawingMeta, paper: PaperSize = "A3"): Drawing {
  const m = briefMetrics(brief);
  const area = drawableArea(paper);
  // Leave room for the dimension lines outside the boundary.
  const scale =
    fitScale(brief.site.widthM * 1.3, brief.site.depthM * 1.3, paper, [100, 200, 500, 1000, 2500]) ??
    2500;
  const mm = mmPerMetre(scale);

  const sw = brief.site.widthM * mm;
  const sd = brief.site.depthM * mm;
  const ox = area.x + (area.widthMm - sw) / 2;
  const oy = area.y + (area.heightMm - sd) / 2;

  // Site y runs BACK from the road; paper y runs down. Frontage at the bottom
  // means a structure `offsetYM` back from the road sits that far UP the page.
  const px = (xm: number) => ox + xm * mm;
  const py = (ym: number) => oy + sd - ym * mm;

  const rect = (s: Structure, fill: string, stroke: string, dash = "") =>
    `<rect x="${dim(px(s.offsetXM))}" y="${dim(py(s.offsetYM + s.depthM))}" ` +
    `width="${dim(s.widthM * mm)}" height="${dim(s.depthM * mm)}" ` +
    `fill="${fill}" stroke="${stroke}" stroke-width="0.4"${dash ? ` stroke-dasharray="${dash}"` : ""}/>` +
    `<text x="${dim(px(s.offsetXM + s.widthM / 2))}" y="${dim(py(s.offsetYM + s.depthM / 2))}" ` +
    `font-size="3" text-anchor="middle" fill="#111">${esc(s.label)}</text>`;

  // Same anticlockwise mapping as briefMetrics — see the note there. These
  // label the dimension lines, so a mismatch would print one boundary's name
  // against another boundary's measurement.
  const front = brief.site.frontage;
  const fi = COMPASS.indexOf(front);
  const right = COMPASS[(fi + 3) % 4];
  const rear = COMPASS[(fi + 2) % 4];
  const left = COMPASS[(fi + 1) % 4];
  const p = brief.proposed;

  const content =
    // Boundary
    `<rect x="${dim(ox)}" y="${dim(oy)}" width="${dim(sw)}" height="${dim(sd)}" fill="#fbfbf9" stroke="#111" stroke-width="0.7"/>` +
    // Road along the frontage
    `<rect x="${dim(ox)}" y="${dim(oy + sd + 1)}" width="${dim(sw)}" height="4" fill="#eee" stroke="#999" stroke-width="0.2"/>` +
    `<text x="${dim(ox + sw / 2)}" y="${dim(oy + sd + 4)}" font-size="2.8" text-anchor="middle" fill="#666">ROAD (${front} boundary)</text>` +
    (brief.existing ? rect(brief.existing, "#f0f0ec", "#666", "1.5 1") : "") +
    rect(p, "#dbe8f5", "#0b5aa6") +
    // Setbacks, one per boundary, each labelled with its compass face.
    dimensionLine({
      x1: px(p.offsetXM), y1: py(0), x2: px(p.offsetXM), y2: py(p.offsetYM),
      label: `${m.setbacksM[front]}m to ${front}`,
    }) +
    dimensionLine({
      x1: px(p.offsetXM + p.widthM), y1: py(p.offsetYM + p.depthM),
      x2: px(brief.site.widthM), y2: py(p.offsetYM + p.depthM),
      label: `${m.setbacksM[right]}m to ${right}`,
    }) +
    dimensionLine({
      x1: px(p.offsetXM + p.widthM / 2), y1: py(p.offsetYM + p.depthM),
      x2: px(p.offsetXM + p.widthM / 2), y2: py(brief.site.depthM),
      label: `${m.setbacksM[rear]}m to ${rear}`,
    }) +
    dimensionLine({
      x1: px(0), y1: py(p.offsetYM + p.depthM), x2: px(p.offsetXM), y2: py(p.offsetYM + p.depthM),
      label: `${m.setbacksM[left]}m to ${left}`,
    }) +
    // Overall site dimensions
    dimensionLine({ x1: px(0), y1: oy - 4, x2: px(brief.site.widthM), y2: oy - 4, label: `${brief.site.widthM}m` }) +
    dimensionLine({ x1: ox - 4, y1: py(0), x2: ox - 4, y2: py(brief.site.depthM), label: `${brief.site.depthM}m` }) +
    northArrow(area.x + area.widthMm - 12, area.y + 14, NORTH_BEARING[front]) +
    scaleBar(area.x + 2, area.y + area.heightMm - 4, scale) +
    // The numbers the form will also quote, printed where they can be checked.
    `<g font-size="2.8" fill="#111">` +
    `<text x="${dim(area.x + 2)}" y="${dim(area.y + 5)}">Site area ${m.siteAreaM2}m²  ·  proposed footprint ${m.proposedFootprintM2}m²  ·  site coverage ${m.siteCoveragePct}%</text>` +
    `<text x="${dim(area.x + 2)}" y="${dim(area.y + 9)}">Private open space retained ${m.openSpaceM2}m²  ·  parking ${brief.access.parkingSpaces} space(s)  ·  tightest setback ${m.tightestSetback.metres}m to ${m.tightestSetback.face}</text>` +
    `</g>`;

  return {
    requirementCode: "site_layout_plan",
    key: "site_layout",
    title: "Proposed site layout plan",
    drawingNumber: "PL-01",
    scale,
    paper,
    svg: sheet({
      paper,
      title: titleFor(meta, "Proposed site layout plan", "PL-01", scale, paper),
      content,
      footnotes: footnotesFor(brief),
    }),
  };
}

/**
 * FLOOR PLAN — the proposed footprint with the rooms laid into it.
 *
 * Rooms are packed left-to-right in rows, at their entered proportions. That is
 * a LAYOUT, not a design: it says how much space each room takes and in what
 * order, and the sheet says so. Pretending a questionnaire can site a stairs
 * or a load-bearing wall would be the dishonest version of this drawing.
 */
export function floorPlan(brief: DesignBrief, meta: DrawingMeta, paper: PaperSize = "A3"): Drawing {
  const area = drawableArea(paper);
  const p = brief.proposed;
  const scale = fitScale(p.widthM * 1.25, p.depthM * 1.35, paper, [50, 100, 200, 500]) ?? 500;
  const mm = mmPerMetre(scale);

  const w = p.widthM * mm;
  const d = p.depthM * mm;
  const ox = area.x + (area.widthMm - w) / 2;
  const oy = area.y + 12;

  // Pack rooms into rows. Scaled so the whole set fits the footprint even when
  // the applicant's rooms add up to more than the outline — reviewBrief warns,
  // and the sheet still shows the proportions rather than overflowing.
  const totalRoomArea = brief.rooms.reduce((a, r) => a + r.widthM * r.depthM, 0);
  const fit = totalRoomArea > 0 ? Math.min(1, (p.widthM * p.depthM) / totalRoomArea) : 1;

  let rooms = "";
  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;
  for (const r of brief.rooms) {
    const rw = Math.min(r.widthM * Math.sqrt(fit), p.widthM);
    const rd = r.depthM * Math.sqrt(fit);
    if (cursorX + rw > p.widthM + 0.001) {
      cursorX = 0;
      cursorY += rowHeight;
      rowHeight = 0;
    }
    if (cursorY + rd > p.depthM + 0.001) break; // no room left; outline stands
    rooms +=
      `<rect x="${dim(ox + cursorX * mm)}" y="${dim(oy + cursorY * mm)}" width="${dim(rw * mm)}" height="${dim(rd * mm)}" ` +
      `fill="#fff" stroke="#555" stroke-width="0.3"/>` +
      `<text x="${dim(ox + (cursorX + rw / 2) * mm)}" y="${dim(oy + (cursorY + rd / 2) * mm)}" font-size="2.6" text-anchor="middle" fill="#111">${esc(r.name)}</text>` +
      `<text x="${dim(ox + (cursorX + rw / 2) * mm)}" y="${dim(oy + (cursorY + rd / 2) * mm + 3.2)}" font-size="2.2" text-anchor="middle" fill="#666">${r.widthM}×${r.depthM}m</text>`;
    cursorX += rw;
    rowHeight = Math.max(rowHeight, rd);
  }

  const content =
    `<rect x="${dim(ox)}" y="${dim(oy)}" width="${dim(w)}" height="${dim(d)}" fill="#f7f7f4" stroke="#111" stroke-width="0.8"/>` +
    rooms +
    dimensionLine({ x1: ox, y1: oy - 5, x2: ox + w, y2: oy - 5, label: `${p.widthM}m` }) +
    dimensionLine({ x1: ox - 5, y1: oy, x2: ox - 5, y2: oy + d, label: `${p.depthM}m` }) +
    scaleBar(area.x + 2, area.y + area.heightMm - 4, scale) +
    `<text x="${dim(area.x + 2)}" y="${dim(area.y + 5)}" font-size="2.8" fill="#111">` +
    `${esc(WORKS_LABELS[brief.works])}  ·  ${p.storeys} storey(s)  ·  floor area ${briefMetrics(brief).proposedFloorAreaM2}m²</text>` +
    `<text x="${dim(area.x + 2)}" y="${dim(area.y + 9)}" font-size="2.6" fill="#8a5a00">` +
    `Room sizes are as entered; their arrangement is indicative and does not show structure, stairs or services.</text>`;

  return {
    requirementCode: "floor_plans",
    key: "floor_plan",
    title: "Proposed floor plan",
    drawingNumber: "PL-02",
    scale,
    paper,
    svg: sheet({
      paper,
      title: titleFor(meta, "Proposed floor plan", "PL-02", scale, paper),
      content,
      footnotes: footnotesFor(brief),
    }),
  };
}

/**
 * ELEVATIONS — all four faces on one sheet.
 *
 * Which face is a gable end follows from the ridge running along the LONGER
 * plan dimension, the way a roof is actually built. Get that wrong and the
 * front elevation of a bungalow comes out as a triangle.
 */
export function elevations(brief: DesignBrief, meta: DrawingMeta, paper: PaperSize = "A3"): Drawing {
  const area = drawableArea(paper);
  const p = brief.proposed;
  const front = brief.site.frontage;

  // Ridge runs along the longer dimension; the short faces are the gables.
  const ridgeAlongWidth = p.widthM >= p.depthM;
  const faceWidth = (face: Frontage): number => {
    const acrossFront = face === front || face === COMPASS[(COMPASS.indexOf(front) + 2) % 4];
    return acrossFront ? p.widthM : p.depthM;
  };
  const isGable = (face: Frontage): boolean => {
    const acrossFront = face === front || face === COMPASS[(COMPASS.indexOf(front) + 2) % 4];
    // Looking at the face across the frontage shows the gable when the ridge
    // runs the other way (i.e. along the depth).
    return acrossFront ? !ridgeAlongWidth : ridgeAlongWidth;
  };

  const widest = Math.max(...COMPASS.map(faceWidth));
  const tallest = p.roof === "flat" ? p.eavesHeightM : p.ridgeHeightM;
  // Two across, two down, with room for titles and dimensions.
  const scale =
    fitScale(widest * 2.4, tallest * 2.9, paper, [50, 100, 200, 500]) ?? 500;
  const mm = mmPerMetre(scale);

  const cellW = area.widthMm / 2;
  const cellH = (area.heightMm - 8) / 2;
  let content = "";
  COMPASS.forEach((face, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const fw = faceWidth(face);
    const baseX = area.x + col * cellW + (cellW - fw * mm) / 2;
    const baseY = area.y + 8 + row * cellH + cellH - 10;
    const role = faceRole(face, front);
    content +=
      `<g transform="translate(${dim(baseX)} ${dim(baseY)})">` +
      `<path d="${elevationOutline(p, fw, mm, isGable(face))}" fill="#eef2f6" stroke="#111" stroke-width="0.5"/>` +
      openingsOnFace(brief.openings[face], fw, mm, p.eavesHeightM) +
      `<line x1="-3" y1="0" x2="${dim(fw * mm + 3)}" y2="0" stroke="#111" stroke-width="0.6"/>` +
      `</g>` +
      dimensionLine({
        x1: baseX + fw * mm + 4, y1: baseY,
        x2: baseX + fw * mm + 4, y2: baseY - tallest * mm,
        label: `${tallest}m`,
      }) +
      `<text x="${dim(area.x + col * cellW + cellW / 2)}" y="${dim(area.y + 6 + row * cellH + cellH - 3)}" ` +
      `font-size="3" text-anchor="middle" fill="#111">Proposed ${role} (${face}) elevation</text>`;
  });

  content +=
    scaleBar(area.x + 2, area.y + area.heightMm - 2, scale) +
    `<text x="${dim(area.x + area.widthMm - 2)}" y="${dim(area.y + 4)}" font-size="2.8" text-anchor="end" fill="#111">` +
    `Eaves ${p.eavesHeightM}m · ridge ${p.ridgeHeightM}m · ${esc(p.externalFinish || "finish to be confirmed")}</text>`;

  return {
    requirementCode: "floor_plans",
    key: "elevations",
    title: "Proposed elevations",
    drawingNumber: "PL-03",
    scale,
    paper,
    svg: sheet({
      paper,
      title: titleFor(meta, "Proposed elevations", "PL-03", scale, paper),
      content,
      footnotes: footnotesFor(brief),
    }),
  };
}

/** SECTION — one cut through the proposed, showing floor-to-ridge heights. */
export function section(brief: DesignBrief, meta: DrawingMeta, paper: PaperSize = "A3"): Drawing {
  const area = drawableArea(paper);
  const p = brief.proposed;
  const tallest = p.roof === "flat" ? p.eavesHeightM : p.ridgeHeightM;
  const scale = fitScale(p.depthM * 1.4, tallest * 1.6, paper, [50, 100, 200, 500]) ?? 500;
  const mm = mmPerMetre(scale);

  const baseX = area.x + (area.widthMm - p.depthM * mm) / 2;
  const baseY = area.y + area.heightMm - 22;
  const storeys = Math.max(1, p.storeys);
  const storeyH = p.eavesHeightM / storeys;

  let floors = "";
  for (let i = 1; i < storeys; i++) {
    floors +=
      `<line x1="0" y1="${dim(-storeyH * i * mm)}" x2="${dim(p.depthM * mm)}" y2="${dim(-storeyH * i * mm)}" stroke="#555" stroke-width="0.4"/>` +
      `<text x="2" y="${dim(-storeyH * i * mm - 1.5)}" font-size="2.4" fill="#666">floor ${i + 1}</text>`;
  }

  const content =
    `<g transform="translate(${dim(baseX)} ${dim(baseY)})">` +
    `<path d="${elevationOutline(p, p.depthM, mm, true)}" fill="#f4f1ea" stroke="#111" stroke-width="0.5"/>` +
    floors +
    `<line x1="-6" y1="0" x2="${dim(p.depthM * mm + 6)}" y2="0" stroke="#111" stroke-width="0.8"/>` +
    `<text x="-6" y="4" font-size="2.4" fill="#666">existing ground level (assumed level)</text>` +
    `</g>` +
    dimensionLine({
      x1: baseX + p.depthM * mm + 6, y1: baseY,
      x2: baseX + p.depthM * mm + 6, y2: baseY - p.eavesHeightM * mm,
      label: `eaves ${p.eavesHeightM}m`,
    }) +
    dimensionLine({
      x1: baseX + p.depthM * mm + 14, y1: baseY,
      x2: baseX + p.depthM * mm + 14, y2: baseY - tallest * mm,
      label: `ridge ${tallest}m`,
    }) +
    dimensionLine({ x1: baseX, y1: baseY + 6, x2: baseX + p.depthM * mm, y2: baseY + 6, label: `${p.depthM}m` }) +
    scaleBar(area.x + 2, area.y + area.heightMm - 2, scale) +
    `<text x="${dim(area.x + 2)}" y="${dim(area.y + 5)}" font-size="2.6" fill="#8a5a00">` +
    `Ground is drawn level. A sloping site changes every height on this sheet and needs a level survey.</text>`;

  return {
    requirementCode: "floor_plans",
    key: "section",
    title: "Proposed section",
    drawingNumber: "PL-04",
    scale,
    paper,
    svg: sheet({
      paper,
      title: titleFor(meta, "Proposed section A-A", "PL-04", scale, paper),
      content,
      footnotes: footnotesFor(brief),
    }),
  };
}

/**
 * SITE LOCATION MAP — the one sheet that is a placeholder, on purpose.
 *
 * Ireland requires this to be based on Ordnance Survey / Tailte Éireann
 * mapping, licensed and bought per application. Generating something that
 * looked like one would be the most expensive kind of helpful: it would be
 * rejected at the counter, and the applicant would not find out until then.
 *
 * So the sheet states what to buy, at what scale, and what to mark on it — and
 * it carries the same title block as the rest so it sits in the set as a
 * visible gap rather than an invisible one.
 */
export function siteLocationMapPlaceholder(
  brief: DesignBrief,
  meta: DrawingMeta,
  paper: PaperSize = "A3"
): Drawing {
  const area = drawableArea(paper);
  const lines = [
    "This sheet is intentionally blank.",
    "",
    "An Irish planning application must include a site location map based on",
    "Ordnance Survey Ireland / Tailte Éireann mapping. That mapping is licensed",
    "and must be purchased for your site — it cannot be generated, and a",
    "substitute will be rejected as an incomplete application.",
    "",
    "What to buy:  a site location map at 1:2500 (urban) or 1:10560 (rural),",
    "              from Tailte Éireann or a licensed reseller.",
    "",
    "What to mark on it:  the site outlined in RED, any land you own that",
    "                     adjoins it outlined in BLUE, and a north point.",
    "",
    "Then upload it against 'Site location map' on this application, and the",
    "checklist will tick it off.",
  ];
  const content =
    `<rect x="${dim(area.x + 8)}" y="${dim(area.y + 8)}" width="${dim(area.widthMm - 16)}" height="${dim(area.heightMm - 16)}" ` +
    `fill="#fffdf7" stroke="#c9a227" stroke-width="0.6" stroke-dasharray="3 2"/>` +
    lines
      .map(
        (l, i) =>
          `<text x="${dim(area.x + 14)}" y="${dim(area.y + 20 + i * 5)}" font-size="${i === 0 ? 3.6 : 3}" fill="${i === 0 ? "#8a5a00" : "#333"}">${esc(l)}</text>`
      )
      .join("");

  return {
    requirementCode: "site_location_map",
    key: "site_location_map",
    title: "Site location map — to be purchased",
    drawingNumber: "PL-00",
    scale: 2500,
    paper,
    svg: sheet({
      paper,
      title: titleFor(meta, "Site location map (to be purchased)", "PL-00", 2500, paper),
      content,
      footnotes: [`• Site: ${brief.site.addressLine ?? meta.siteAddress ?? "address not entered"}`],
    }),
  };
}

/** The whole set, in the order a planner reads it. */
export function renderDrawingSet(
  brief: DesignBrief,
  meta: DrawingMeta,
  paper: PaperSize = "A3"
): Drawing[] {
  return [
    siteLocationMapPlaceholder(brief, meta, paper),
    siteLayoutPlan(brief, meta, paper),
    floorPlan(brief, meta, paper),
    elevations(brief, meta, paper),
    section(brief, meta, paper),
  ];
}
