/**
 * Minimal RFC-4180-ish CSV handling for prospect import/export — handles
 * quoted fields, embedded commas, escaped quotes and both line endings.
 * A dependency-free ~50 lines beats pulling in a parser package for one
 * internal import screen.
 */

export function parseCsv(text: string): string[][] {
  // Copying cells straight out of Google Sheets / Excel produces
  // TAB-separated lines, not commas — detect that from the first line so a
  // direct spreadsheet paste just works alongside real CSV files.
  const firstNewline = text.search(/\r?\n/);
  const firstLine = firstNewline === -1 ? text : text.slice(0, firstNewline);
  const delimiter = firstLine.includes("\t") ? "\t" : ",";

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const cellToStr = (cell: string | number | null | undefined): string => {
    if (cell === null || cell === undefined) return "";
    // Numbers can never be a spreadsheet formula — pass them through as-is.
    if (typeof cell === "number") return String(cell);
    let s = String(cell);
    // Neutralise CSV/formula injection: a value a spreadsheet would execute
    // as a formula (starts with = + - @, or a tab/CR) is prefixed with a
    // quote so it renders as harmless text. Exports carry external content
    // (inbound reply bodies, scraped company names), so this matters.
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return s;
  };
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const s = cellToStr(cell);
          return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(",")
    )
    .join("\r\n");
}
