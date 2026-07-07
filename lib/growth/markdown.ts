export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Minimal Markdown → HTML for proposals (headings, bold/italic,
 * bullet/numbered lists, paragraphs). Escapes everything first so no HTML
 * from the content survives — safe to inject into the workspace preview and
 * the print export alike; enough formatting without a dependency.
 */
export function markdownToHtml(md: string): string {
  const inline = (s: string) =>
    s
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>");

  const blocks = escapeHtml(md).split(/\n{2,}/);
  return blocks
    .map((block) => {
      const lines = block.split("\n").filter((l) => l.trim());
      if (lines.length === 0) return "";
      if (/^#{1,3}\s/.test(lines[0])) {
        const level = lines[0].startsWith("###") ? 3 : lines[0].startsWith("##") ? 2 : 1;
        return `<h${level}>${inline(lines[0].replace(/^#{1,3}\s*/, ""))}</h${level}>`;
      }
      if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
        return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-*]\s+/, ""))}</li>`).join("")}</ul>`;
      }
      if (lines.every((l) => /^\s*\d+\.\s+/.test(l))) {
        return `<ol>${lines.map((l) => `<li>${inline(l.replace(/^\s*\d+\.\s+/, ""))}</li>`).join("")}</ol>`;
      }
      return `<p>${inline(lines.join("<br/>"))}</p>`;
    })
    .join("\n");
}
