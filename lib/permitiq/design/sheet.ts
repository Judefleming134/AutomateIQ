/**
 * The drawing sheet: paper, scale, and the furniture every planning drawing
 * carries.
 *
 * THE UNIT IS THE MILLIMETRE, and the SVG viewBox is the paper. An A3 sheet is
 * `viewBox="0 0 420 297"`, so one SVG user unit is one millimetre of printed
 * paper and the scale is honest by construction: at 1:100, one metre of the
 * real world is exactly 10 units here, and a planner laying a scale rule on
 * the print reads the number the applicant typed.
 *
 * This is why nothing in the pipeline fits a drawing to the page by stretching
 * it. `mmPerMetre` is the only conversion, it comes from the declared scale,
 * and a drawing too big for its sheet gets a bigger sheet or a coarser scale —
 * never a squeeze. A stretched planning drawing is a lie a scale rule catches.
 */

import { PRELIMINARY_STAMP } from "./brief";

/** Paper sizes, in millimetres, landscape. */
export const PAPER = {
  A4: { widthMm: 297, heightMm: 210 },
  A3: { widthMm: 420, heightMm: 297 },
  A2: { widthMm: 594, heightMm: 420 },
  A1: { widthMm: 841, heightMm: 594 },
} as const;

export type PaperSize = keyof typeof PAPER;

/** Scales a planning drawing is allowed to be at. */
export const SCALES = [50, 100, 200, 500, 1000, 2500] as const;
export type Scale = (typeof SCALES)[number];

/** Millimetres on paper per metre on the ground. 1:100 → 10mm/m. */
export function mmPerMetre(scale: Scale): number {
  return 1000 / scale;
}

/** Margin inside the sheet edge, and the title block's height. */
export const MARGIN_MM = 10;
export const TITLE_BLOCK_MM = 34;

/**
 * The drawable area once the border and title block are taken out. Anything
 * that must fit "on the sheet" is measured against this, not the paper.
 */
export function drawableArea(paper: PaperSize) {
  const p = PAPER[paper];
  return {
    x: MARGIN_MM,
    y: MARGIN_MM,
    widthMm: p.widthMm - MARGIN_MM * 2,
    heightMm: p.heightMm - MARGIN_MM * 2 - TITLE_BLOCK_MM,
  };
}

/**
 * The largest listed scale at which `widthM × heightM` still fits.
 *
 * Returns the COARSEST scale needed rather than the finest that fits, and
 * returns null when even 1:2500 is too small — because the alternative is
 * silently drawing off the edge of the paper. A caller that gets null must
 * offer a bigger sheet, and this function has no business making that choice
 * quietly.
 */
export function fitScale(
  widthM: number,
  heightM: number,
  paper: PaperSize,
  preferred: Scale[] = [...SCALES]
): Scale | null {
  const area = drawableArea(paper);
  for (const scale of [...preferred].sort((a, b) => a - b)) {
    const mm = mmPerMetre(scale);
    if (widthM * mm <= area.widthMm && heightM * mm <= area.heightMm) return scale;
  }
  return null;
}

const esc = (s: string) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** One decimal, and never "-0". */
export const dim = (n: number) => {
  const r = Math.round(n * 10) / 10;
  return String(Object.is(r, -0) ? 0 : r);
};

/**
 * A dimension line with its measurement written on it — the thing that makes a
 * drawing a measured document rather than a picture.
 *
 * Horizontal or vertical only. A planning drawing dimensions along the axes,
 * and an angled dimension on a rectangular site is a sign something has gone
 * wrong upstream rather than a feature worth supporting.
 */
export function dimensionLine(opts: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label: string;
  /** Nudges the text clear of the geometry it measures. */
  offset?: number;
}): string {
  const { x1, y1, x2, y2, label } = opts;
  const off = opts.offset ?? 3;
  const vertical = Math.abs(x2 - x1) < 0.001;
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  const tick = 1.2;
  const ticks = vertical
    ? `<line x1="${x1 - tick}" y1="${y1}" x2="${x1 + tick}" y2="${y1}"/><line x1="${x2 - tick}" y1="${y2}" x2="${x2 + tick}" y2="${y2}"/>`
    : `<line x1="${x1}" y1="${y1 - tick}" x2="${x1}" y2="${y1 + tick}"/><line x1="${x2}" y1="${y2 - tick}" x2="${x2}" y2="${y2 + tick}"/>`;
  const text = vertical
    ? `<text x="${midX - off}" y="${midY}" transform="rotate(-90 ${midX - off} ${midY})" text-anchor="middle" font-size="3">${esc(label)}</text>`
    : `<text x="${midX}" y="${midY - off}" text-anchor="middle" font-size="3">${esc(label)}</text>`;
  return `<g class="dim" stroke="#333" stroke-width="0.2" fill="#333"><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>${ticks}${text}</g>`;
}

/**
 * A scale bar, drawn from the same `mmPerMetre` the geometry used.
 *
 * Deliberately derived rather than passed in. A scale bar that is a separate
 * constant is a scale bar that can disagree with the drawing after someone
 * changes one of them, and a wrong scale bar is worse than none — it is the
 * thing a planner trusts when the print has been photocopied at 94%.
 */
export function scaleBar(x: number, y: number, scale: Scale, metres = 10): string {
  const mm = mmPerMetre(scale);
  const total = metres * mm;
  const segments = 4;
  const seg = total / segments;
  let bars = "";
  for (let i = 0; i < segments; i++) {
    bars += `<rect x="${dim(x + i * seg)}" y="${dim(y)}" width="${dim(seg)}" height="1.6" fill="${i % 2 ? "#fff" : "#333"}" stroke="#333" stroke-width="0.2"/>`;
  }
  return (
    `<g class="scalebar">${bars}` +
    `<text x="${dim(x)}" y="${dim(y + 5)}" font-size="2.6" fill="#333">0</text>` +
    `<text x="${dim(x + total)}" y="${dim(y + 5)}" font-size="2.6" fill="#333" text-anchor="end">${metres}m</text>` +
    `<text x="${dim(x + total / 2)}" y="${dim(y - 1.5)}" font-size="2.6" fill="#333" text-anchor="middle">1:${scale}</text>` +
    `</g>`
  );
}

/**
 * North arrow, rotated so it points at true north on the page.
 *
 * `bearingDeg` is where north sits: 0 draws it up the page. It is a parameter
 * and not a constant because the site layout is drawn in site coordinates —
 * frontage across the bottom — and only the arrow tells the reader how that
 * relates to north. An arrow hard-coded to "up" on a site whose frontage faces
 * west is a drawing that reads as a completely different building.
 */
export function northArrow(x: number, y: number, bearingDeg = 0): string {
  return (
    `<g class="north" transform="translate(${dim(x)} ${dim(y)}) rotate(${dim(bearingDeg)})" stroke="#333" fill="#333">` +
    `<path d="M 0 -7 L 2.6 5 L 0 3 L -2.6 5 Z" stroke-width="0.2"/>` +
    `<text x="0" y="-8.5" font-size="3.2" text-anchor="middle" stroke="none">N</text>` +
    `</g>`
  );
}

export type TitleBlock = {
  project: string;
  drawingTitle: string;
  scale: Scale;
  paper: PaperSize;
  siteAddress?: string;
  applicant?: string;
  drawingNumber: string;
  /** Fixed by the caller so a re-render is byte-identical. */
  dateISO: string;
};

/**
 * The title block, plus the PRELIMINARY stamp.
 *
 * The stamp is welded in here rather than added by each sheet, so a new sheet
 * type cannot be introduced without it. It is the one piece of text on these
 * drawings that protects the applicant from the drawings.
 */
export function titleBlock(paper: PaperSize, t: TitleBlock): string {
  const p = PAPER[paper];
  const top = p.heightMm - MARGIN_MM - TITLE_BLOCK_MM;
  const left = MARGIN_MM;
  const width = p.widthMm - MARGIN_MM * 2;
  const line = (y: number) =>
    `<line x1="${left}" y1="${dim(y)}" x2="${dim(left + width)}" y2="${dim(y)}" stroke="#333" stroke-width="0.2"/>`;
  const field = (x: number, y: number, label: string, value: string, size = 3.4) =>
    `<text x="${dim(x)}" y="${dim(y)}" font-size="2.2" fill="#666">${esc(label)}</text>` +
    `<text x="${dim(x)}" y="${dim(y + 4.2)}" font-size="${size}" fill="#111">${esc(value)}</text>`;

  const col2 = left + width * 0.45;
  const col3 = left + width * 0.72;

  return (
    `<g class="titleblock">` +
    `<rect x="${left}" y="${dim(top)}" width="${dim(width)}" height="${TITLE_BLOCK_MM}" fill="#fff" stroke="#333" stroke-width="0.4"/>` +
    line(top + 11) +
    // The stamp band, across the full width, first thing the eye lands on.
    `<rect x="${left}" y="${dim(top)}" width="${dim(width)}" height="11" fill="#fdf2e2" stroke="#333" stroke-width="0.4"/>` +
    `<text x="${dim(left + 2)}" y="${dim(top + 6.8)}" font-size="3" fill="#8a5a00">${esc(PRELIMINARY_STAMP)}</text>` +
    field(left + 2, top + 16, "PROJECT", t.project) +
    field(col2, top + 16, "DRAWING", t.drawingTitle) +
    field(col3, top + 16, "SCALE @ " + t.paper, `1:${t.scale}`) +
    field(left + 2, top + 25, "SITE", t.siteAddress || "—", 2.8) +
    field(col2, top + 25, "APPLICANT", t.applicant || "—", 2.8) +
    field(col3, top + 25, "DRAWING No.", `${t.drawingNumber}  ·  ${t.dateISO}`, 2.8) +
    `</g>`
  );
}

/**
 * Wraps sheet content in the paper, the border and the title block.
 *
 * `content` is already in millimetre paper coordinates. Keeping the transform
 * out here means every sheet renderer decides its own placement explicitly,
 * rather than inheriting an offset it can't see.
 */
export function sheet(opts: {
  paper: PaperSize;
  title: TitleBlock;
  content: string;
  /** Printed under the drawing — issues, notes, what isn't shown. */
  footnotes?: string[];
}): string {
  const p = PAPER[opts.paper];
  const notes = (opts.footnotes ?? [])
    .slice(0, 6)
    .map(
      (n, i) =>
        `<text x="${MARGIN_MM + 2}" y="${dim(p.heightMm - MARGIN_MM - TITLE_BLOCK_MM - 3 - (opts.footnotes!.slice(0, 6).length - 1 - i) * 4)}" font-size="2.6" fill="#8a5a00">${esc(n)}</text>`
    )
    .join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${p.widthMm}mm" height="${p.heightMm}mm" ` +
    `viewBox="0 0 ${p.widthMm} ${p.heightMm}" role="img" aria-label="${esc(opts.title.drawingTitle)}">` +
    `<rect width="${p.widthMm}" height="${p.heightMm}" fill="#fff"/>` +
    `<rect x="${MARGIN_MM / 2}" y="${MARGIN_MM / 2}" width="${dim(p.widthMm - MARGIN_MM)}" height="${dim(p.heightMm - MARGIN_MM)}" fill="none" stroke="#333" stroke-width="0.5"/>` +
    `<g class="content">${opts.content}</g>` +
    notes +
    titleBlock(opts.paper, opts.title) +
    `</svg>`
  );
}

export { esc as escapeSvgText };
