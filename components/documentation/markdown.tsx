import React from "react";

/**
 * Dependency-free markdown → React renderer for the Documentation Centre.
 * Renders to real React nodes (never dangerouslySetInnerHTML), styled in the
 * platform's premium dark language. Supports headings (with anchor ids for
 * the table of contents), paragraphs, bold/italic/inline-code/links,
 * ordered/unordered lists, task checklists, tables, blockquote callouts,
 * fenced code blocks and horizontal rules.
 */

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
}

export type Heading = { level: number; text: string; id: string };

/** Extract headings (h2/h3) for the table of contents. */
export function extractHeadings(md: string): Heading[] {
  const out: Heading[] = [];
  let inFence = false;
  for (const line of md.split("\n")) {
    if (line.trim().startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^(#{2,3})\s+(.*)$/.exec(line);
    if (m) out.push({ level: m[1].length, text: m[2].trim(), id: slugify(m[2].trim()) });
  }
  return out;
}

// ---- inline ---------------------------------------------------------------
function renderInline(text: string, key: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // Split on the four inline constructs; keep delimiters via capture groups.
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|\*[^*]+\*)/g;
  const parts = text.split(re);
  parts.forEach((part, i) => {
    if (!part) return;
    const k = `${key}-${i}`;
    if (part.startsWith("**") && part.endsWith("**")) {
      nodes.push(<strong key={k}>{part.slice(2, -2)}</strong>);
    } else if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      nodes.push(<code key={k} className="doc-code-inline">{part.slice(1, -1)}</code>);
    } else if (/^\[[^\]]+\]\([^)]+\)$/.test(part)) {
      const m = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part)!;
      const href = m[2];
      const external = /^https?:\/\//.test(href);
      nodes.push(
        <a key={k} href={href} className="doc-link" {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
          {m[1]}
        </a>
      );
    } else if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      nodes.push(<em key={k}>{part.slice(1, -1)}</em>);
    } else {
      nodes.push(<React.Fragment key={k}>{part}</React.Fragment>);
    }
  });
  return nodes;
}

const CALLOUT_META: Record<string, { cls: string; icon: string; label: string }> = {
  NOTE: { cls: "doc-callout-note", icon: "ℹ", label: "Note" },
  TIP: { cls: "doc-callout-tip", icon: "✓", label: "Tip" },
  IMPORTANT: { cls: "doc-callout-important", icon: "★", label: "Important" },
  WARNING: { cls: "doc-callout-warning", icon: "!", label: "Warning" },
};

export function Markdown({ content }: { content: string }) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code
    if (line.trim().startsWith("```")) {
      const lang = line.trim().slice(3).trim();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        buf.push(lines[i]);
        i++;
      }
      i++; // closing fence
      blocks.push(
        <pre key={key++} className="doc-code-block" data-lang={lang}>
          <code>{buf.join("\n")}</code>
        </pre>
      );
      continue;
    }

    // Blank line
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      blocks.push(<hr key={key++} className="doc-hr" />);
      i++;
      continue;
    }

    // Heading
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const text = h[2].trim();
      const id = slugify(text);
      const Tag = (`h${Math.min(level, 4)}`) as keyof React.JSX.IntrinsicElements;
      blocks.push(
        <Tag key={key++} id={id} className={`doc-h doc-h${level}`}>
          {renderInline(text, `h${key}`)}
        </Tag>
      );
      i++;
      continue;
    }

    // Blockquote / callout
    if (line.trimStart().startsWith(">")) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].trimStart().startsWith(">")) {
        buf.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      const first = buf[0] ?? "";
      const cm = /^\[!(\w+)\]\s*(.*)$/.exec(first);
      if (cm && CALLOUT_META[cm[1].toUpperCase()]) {
        const meta = CALLOUT_META[cm[1].toUpperCase()];
        const body = [cm[2], ...buf.slice(1)].filter((x) => x !== "").join(" ");
        blocks.push(
          <div key={key++} className={`doc-callout ${meta.cls}`}>
            <span className="doc-callout-icon">{meta.icon}</span>
            <div>
              <strong className="doc-callout-label">{meta.label}</strong>
              <p>{renderInline(body, `co${key}`)}</p>
            </div>
          </div>
        );
      } else {
        blocks.push(
          <blockquote key={key++} className="doc-quote">
            {renderInline(buf.join(" "), `bq${key}`)}
          </blockquote>
        );
      }
      continue;
    }

    // Table (header row + separator + body)
    if (line.includes("|") && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
      const parseRow = (r: string) =>
        r.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
      const header = parseRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        rows.push(parseRow(lines[i]));
        i++;
      }
      blocks.push(
        <div key={key++} className="doc-table-wrap">
          <table className="doc-table">
            <thead>
              <tr>{header.map((c, ci) => <th key={ci}>{renderInline(c, `th${key}-${ci}`)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((c, ci) => <td key={ci}>{renderInline(c, `td${key}-${ri}-${ci}`)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // Task checklist
    if (/^\s*[-*]\s+\[[ xX]\]\s+/.test(line)) {
      const items: { checked: boolean; text: string }[] = [];
      while (i < lines.length && /^\s*[-*]\s+\[[ xX]\]\s+/.test(lines[i])) {
        const m = /^\s*[-*]\s+\[([ xX])\]\s+(.*)$/.exec(lines[i])!;
        items.push({ checked: m[1].toLowerCase() === "x", text: m[2] });
        i++;
      }
      blocks.push(
        <ul key={key++} className="doc-checklist">
          {items.map((it, ii) => (
            <li key={ii} className={it.checked ? "is-checked" : ""}>
              <span className="doc-check">{it.checked ? "✓" : ""}</span>
              <span>{renderInline(it.text, `cl${key}-${ii}`)}</span>
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      blocks.push(
        <ol key={key++} className="doc-ol">
          {items.map((it, ii) => <li key={ii}>{renderInline(it, `ol${key}-${ii}`)}</li>)}
        </ol>
      );
      continue;
    }

    // Unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i]) && !/^\s*[-*]\s+\[[ xX]\]/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      blocks.push(
        <ul key={key++} className="doc-ul">
          {items.map((it, ii) => <li key={ii}>{renderInline(it, `ul${key}-${ii}`)}</li>)}
        </ul>
      );
      continue;
    }

    // Paragraph (gather consecutive non-blank, non-structural lines)
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^(#{1,4})\s/.test(lines[i]) &&
      !lines[i].trimStart().startsWith(">") &&
      !lines[i].trim().startsWith("```") &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^(-{3,}|\*{3,})$/.test(lines[i].trim())
    ) {
      para.push(lines[i]);
      i++;
    }
    if (para.length) {
      blocks.push(<p key={key++} className="doc-p">{renderInline(para.join(" "), `p${key}`)}</p>);
    }
  }

  return <div className="doc-body">{blocks}</div>;
}
