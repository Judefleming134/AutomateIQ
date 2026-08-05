import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseQuoteTotal } from "./quote-to-crm";
import { parseMoneyToCents } from "./invoice";

/**
 * The QuoteIQ dashboard added up money with its own parser, and it was the
 * wrong one.
 *
 *     const n = parseFloat(total.replace(/[^0-9.]/g, ""));
 *
 * `qa_quotes.total` is TEXT on purpose — invoice.ts says it plainly: "a quote
 * is a human sentence ('from €900')". So a total routinely carries more than
 * one number, and stripping every non-digit CONCATENATES them:
 *
 *   qa_quotes.total                  OLD (dashboard)    NEW
 *   €2,400                           €2,400             €2,400
 *   from €900                        €900               €900
 *   €1,200 – €1,500                  €12,001,500        €1,200
 *   Deposit €500, balance €1,500     €5,001,500         €500
 *   €120 per hour, 8 hours = €960    €1,208,960         €120
 *   €950 + VAT                       €950               €950
 *   TBC                              €0 (silently)      — (counted, named)
 *
 * Summed as accepted quotes, those eight totals put "Won value" at €18,218,610
 * instead of €8,470 — 2,151× over, on the headline number of the product sold
 * as "watch it move from sent to won".
 *
 * The platform already HAS the right parser for this column: parseQuoteTotal,
 * which ClientIQ uses to write crm_contacts.value for these exact quotes. So
 * the two screens disagreed about the same quote, and the dashboard was the
 * one that was wrong.
 *
 * parseQuoteTotal had its own smaller version of the same fault, found while
 * wiring it up: it split ranges on the CLEANED string, by which point
 * "€1,200 – €1,500" had become "1,2001,500" with no separator left — and it
 * read ONE EURO out of the join. That figure was being stored as the deal
 * value in ClientIQ. It now splits on the original text, with the same
 * separator set parseMoneyToCents already used.
 *
 * Two other caps went with it: the stat cards were computed from the newest 50
 * quotes (the list's own limit), and an unreadable total was folded in as zero
 * with nothing said.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const PAGE = readFileSync(
  path.join(ROOT, "app", "portal", "instant-quote-agent", "page.tsx"),
  "utf8"
);

/** The dashboard's own parser, exactly as it was. */
const OLD = (total: string | null): number => {
  if (!total) return 0;
  const n = parseFloat(total.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

const TOTALS: [string, number, number | null][] = [
  // input,                          OLD,        NEW
  ["€2,400", 2400, 2400],
  ["€2,400.00", 2400, 2400],
  ["from €900", 900, 900],
  ["€1,200 – €1,500", 12001500, 1200],
  ["Deposit €500, balance €1,500", 5001500, 500],
  ["€120 per hour, 8 hours = €960", 1208960, 120],
  ["€950 + VAT", 950, 950],
  ["TBC", 0, null],
];

describe("what the dashboard was adding up", () => {
  it.each(TOTALS)("%s — was %s, is now %s", (input, old, now) => {
    expect(OLD(input)).toBe(old);
    expect(parseQuoteTotal(input)).toBe(now);
  });

  it("a multi-number total was inflated by orders of magnitude", () => {
    const multi = TOTALS.filter(([, o, n]) => o !== (n ?? 0));
    expect(multi.map(([i]) => i)).toEqual([
      "€1,200 – €1,500",
      "Deposit €500, balance €1,500",
      "€120 per hour, 8 hours = €960",
    ]);
  });

  it("'Won value' over these eight reads €18.2m instead of €8,470", () => {
    const oldSum = TOTALS.reduce((s, [i]) => s + OLD(i), 0);
    const newSum = TOTALS.reduce((s, [i]) => s + (parseQuoteTotal(i) ?? 0), 0);
    expect(oldSum).toBe(18_218_610);
    expect(newSum).toBe(8_470);
    expect(Math.round(oldSum / newSum)).toBe(2151);
  });

  it("the plain totals — the ones that made it look fine — are unchanged", () => {
    for (const t of ["€2,400", "€2,400.00", "from €900", "€950 + VAT"]) {
      expect(parseQuoteTotal(t), t).toBe(OLD(t));
    }
  });
});

describe("parseQuoteTotal's own range bug, which ClientIQ was storing", () => {
  it("an en-dash range used to resolve to ONE EURO", () => {
    // The old split ran on the cleaned string: "€1,200 – €1,500" had already
    // become "1,2001,500", the separator was gone, and the digit match took
    // the leading "1".
    const cleanedFirst = "€1,200 – €1,500".replace(/[^\d.,-]/g, "").trim();
    expect(cleanedFirst).toBe("1,2001,500");
    expect(cleanedFirst.split(/(?<=\d)\s*-\s*(?=\d)/)[0]).toBe("1,2001,500");
    expect(Number(cleanedFirst.replace(/,(?=\d{3}\b)/g, "").match(/-?\d+(?:\.\d+)?/)![0])).toBe(1);
  });

  it("every separator now takes the low end", () => {
    for (const t of [
      "900-1200",
      "€900 - €1,200",
      "€900 – €1,200",
      "€900 — €1,200",
      "€900 to €1,200",
    ]) {
      expect(parseQuoteTotal(t), t).toBe(900);
    }
  });

  it("it uses the same separator set as the invoice parser", () => {
    // invoice.ts hit this from the other side and REFUSES a range outright,
    // because an invoice is an exact demand. Both must recognise the same
    // shapes, or one of them silently disagrees about what a range is.
    for (const t of ["€900 - €1,200", "€900 – €1,200", "€900 — €1,200", "€900 to €1,200"]) {
      expect(parseMoneyToCents(t), t).toBeNull();
      expect(parseQuoteTotal(t), t).toBe(900);
    }
  });

  it("and nothing that isn't a range got caught by it", () => {
    expect(parseQuoteTotal("from €900")).toBe(900);
    expect(parseQuoteTotal("1,000,000")).toBe(1000000);
    expect(parseQuoteTotal("  €2,499.99  ")).toBe(2499.99);
    expect(parseQuoteTotal("-500")).toBeNull(); // still refused
    expect(parseQuoteTotal("TBC")).toBeNull();
  });
});

describe("the page uses the shared parser, not a third one", () => {
  it("its own parseMoney is gone", () => {
    expect(PAGE).not.toContain("function parseMoney");
    expect(PAGE).not.toContain('replace(/[^0-9.]/g, "")');
  });

  it("and it imports the one ClientIQ writes crm_contacts.value with", () => {
    expect(PAGE).toContain('import { parseQuoteTotal } from "@/lib/quote-agent/quote-to-crm";');
    expect(PAGE).toContain("parseQuoteTotal(q.total) ?? 0");
  });
});

describe("the stat cards describe the whole pipeline, not the newest 50", () => {
  it("they read every quote's status and total", () => {
    expect(PAGE).toContain("const LIST_CAP = 50;");
    expect(PAGE).toContain(".limit(LIST_CAP)");
    expect(PAGE).toContain('supabase.from("qa_quotes").select("status, total")');
    expect(PAGE).toContain("selectAllRows<Slim>");
  });

  it("the metrics are computed from that, not from the rendered list", () => {
    for (const line of [
      'const accepted = forStats.filter((q) => q.status === "accepted");',
      'const live = forStats.filter((q) => ["sent", "viewed"].includes(q.status ?? ""));',
    ]) {
      expect(PAGE).toContain(line);
    }
    expect(PAGE).not.toContain('const accepted = all.filter');
  });

  it("a read failure degrades to the old behaviour rather than failing the page", () => {
    // selectAllRows throws on an incomplete page by design.
    expect(PAGE).toContain("let forStats: Slim[] = all;");
    expect(PAGE).toContain("statsAreWholePipeline = true;");
    expect(PAGE).toContain("pipeline stats fell back to the visible page");
  });

  it("and the list says it is showing fewer than the figures cover", () => {
    expect(PAGE).toContain("statsAreWholePipeline && forStats.length > all.length");
    expect(PAGE).toContain("The figures above");
  });
});

describe("an unreadable total is named, not folded in as zero", () => {
  it("both value cards count them", () => {
    expect(PAGE).toContain(
      "const unpricedWon = accepted.filter((q) => parseQuoteTotal(q.total) === null).length;"
    );
    expect(PAGE).toContain(
      "const unpricedOpen = live.filter((q) => parseQuoteTotal(q.total) === null).length;"
    );
    expect(PAGE).toContain("unpricedNote(unpricedWon)");
    expect(PAGE).toContain("unpricedNote(unpricedOpen)");
  });

  it("the note stays silent when everything is priced", () => {
    const note = (n: number) => (n > 0 ? `, ${n} unpriced` : "");
    expect(note(0)).toBe("");
    expect(note(3)).toBe(", 3 unpriced");
    expect(PAGE).toContain('const unpricedNote = (n: number) => (n > 0 ? `, ${n} unpriced` : "");');
  });

  it("it is a real risk, not a hypothetical — the parser refuses these on purpose", () => {
    for (const t of ["TBC", "on application", "price on application"]) {
      expect(parseQuoteTotal(t), t).toBeNull();
    }
  });
});

describe("nothing was taken away", () => {
  it("all four cards, the generator, the price guide and invoicing are intact", () => {
    for (const s of [
      'label="Won value"',
      'label="Open value"',
      'label="Acceptance rate"',
      'label="Price guide"',
      "<QuoteGenerator hasPriceGuide={hasPriceGuide} />",
      "savePriceGuide",
      "invoicingReady && quote.status === \"accepted\"",
      "No quotes yet — create your first one above.",
    ]) {
      expect(PAGE, s).toContain(s);
    }
  });
});
