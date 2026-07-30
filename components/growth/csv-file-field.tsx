"use client";

import { useRef, useState } from "react";
import { FileUp, Check, AlertTriangle } from "lucide-react";
import { MAX_IMPORT_ROWS } from "@/lib/growth/constants";

// file.text() on a very large file blocks the tab while it decodes, and nothing
// legitimate here is anywhere near this big: 3,000 rows of CRM columns is well
// under 1MB. A 10MB "csv" is a database dump or the wrong file entirely.
const MAX_FILE_BYTES = 10 * 1024 * 1024;

/**
 * The import form's data field: drop / choose a .csv or .tsv file, or paste
 * rows directly. A chosen file is read in the browser and fills the same
 * textarea the server action already consumes — one code path either way.
 */
export function CsvFileField() {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const rowCount = Math.max(
    0,
    text.split(/\r?\n/).filter((l) => l.trim()).length - 1
  );
  // The server refuses anything over the cap — but only AFTER the import action
  // has run, which is the slowest thing in the app. Saying so here means the
  // file gets split before the submit, not after a long wait ending in an error.
  const overCap = rowCount > MAX_IMPORT_ROWS;

  async function handleFile(file: File | undefined | null) {
    setNotice(null);
    if (!file) return;
    // Catch the common wrong-file drops (spreadsheets, docs, PDFs) before we
    // read them — otherwise file.text() decodes the binary as garbage and
    // dumps it into the paste box with no explanation.
    if (/\.(xlsx?|numbers|ods|pdf|docx?|pages|key|pptx?)$/i.test(file.name)) {
      setNotice(
        "That's not a CSV file. Export it as Comma Separated Values first — in Google Sheets: File → Download → .csv (or Excel/Numbers: Save As / Export → CSV) — then drop that file here."
      );
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setNotice(
        `That file is ${(file.size / (1024 * 1024)).toFixed(1)}MB — far too big to be a prospect list (${MAX_IMPORT_ROWS.toLocaleString("en-IE")} rows is under 1MB). Check you picked the right file, or export just the columns you need.`
      );
      return;
    }
    let content: string;
    try {
      content = await file.text();
    } catch {
      setNotice("Couldn't read that file — try again, or paste the rows below instead.");
      return;
    }
    setText(content);
    setFileName(file.name);
  }

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-label="Drop a CSV file here or click to choose one"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFile(e.dataTransfer.files?.[0]);
        }}
        style={{
          border: `2px dashed ${dragOver ? "var(--ac2, #3b82f6)" : "var(--line2, rgba(255,255,255,.18))"}`,
          borderRadius: 10,
          padding: "22px 16px",
          textAlign: "center",
          cursor: "pointer",
          background: dragOver ? "rgba(59,130,246,.08)" : "transparent",
          transition: "border-color .15s, background .15s",
        }}
      >
        {fileName && overCap ? (
          <span style={{ color: "var(--orange, #fb923c)", fontSize: 14 }}>
            <AlertTriangle size={14} style={{ verticalAlign: "-2px" }} /> {fileName}{" "}
            loaded — {rowCount.toLocaleString("en-IE")} rows, too many for one
            import
          </span>
        ) : fileName ? (
          <span style={{ color: "var(--green, #34d399)", fontSize: 14 }}>
            <Check size={14} style={{ verticalAlign: "-2px" }} /> {fileName} loaded —{" "}
            {rowCount.toLocaleString("en-IE")} row{rowCount === 1 ? "" : "s"} ready to
            import
          </span>
        ) : (
          <span style={{ color: "var(--faint)", fontSize: 14 }}>
            <FileUp size={15} style={{ verticalAlign: "-2px" }} /> Drop your .csv
            here, or click to choose the file
          </span>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
        style={{ display: "none" }}
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      {notice && (
        <p style={{ color: "var(--orange, #fb923c)", fontSize: 12, margin: "8px 0 0" }}>
          {notice}
        </p>
      )}
      {overCap && (
        // Same limit and the same advice the server gives, said before the wait.
        <p style={{ color: "var(--orange, #fb923c)", fontSize: 12, margin: "8px 0 0" }}>
          That&apos;s {rowCount.toLocaleString("en-IE")} rows — up to{" "}
          {MAX_IMPORT_ROWS.toLocaleString("en-IE")} go in at a time so the import
          doesn&apos;t time out. Split it and run the rest after (duplicates are
          skipped automatically).
        </p>
      )}
      <label htmlFor="imp-csv" style={{ marginTop: 12, display: "block" }}>
        …or paste the rows (straight from Google Sheets works)
      </label>
      <textarea
        id="imp-csv"
        name="csv"
        rows={5}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setFileName(null);
        }}
        placeholder={`company,contact_name,industry,phone\nMurphy Plumbing,Owner,Plumbing,085 123 4567`}
      />
    </div>
  );
}
