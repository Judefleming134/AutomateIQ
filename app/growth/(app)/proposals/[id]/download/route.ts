import { requireGrowth } from "@/lib/growth/auth";
import { createAdminClient } from "@/lib/supabase/admin";

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Minimal Markdown → HTML for proposal export (headings, bold/italic,
 * bullet/numbered lists, paragraphs). Escapes everything first so no HTML
 * from the content survives; enough for print-to-PDF without a dependency.
 */
function markdownToHtml(md: string): string {
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

/** Print-ready proposal document (open → print → save as PDF). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireGrowth();
  const { id } = await params;

  const admin = createAdminClient();
  const { data: proposal } = await admin
    .from("ge_proposals")
    .select("title, content, updated_at, ge_prospects(company)")
    .eq("id", id)
    .maybeSingle();
  if (!proposal) return new Response("Not found", { status: 404 });

  const company =
    (proposal.ge_prospects as unknown as { company: string } | null)?.company ?? "";
  const date = new Date(proposal.updated_at).toLocaleDateString("en-IE", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="robots" content="noindex"/>
<title>${escapeHtml(proposal.title)}</title>
<style>
  body { font-family: Georgia, 'Times New Roman', serif; color: #1a1d24; max-width: 720px; margin: 0 auto; padding: 48px 28px; line-height: 1.65; font-size: 15px; }
  .brand { font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; letter-spacing: 0.08em; text-transform: uppercase; font-size: 12px; color: #2563eb; font-weight: 700; }
  h1 { font-size: 26px; margin: 8px 0 2px; }
  .meta { color: #6b7280; font-size: 13px; margin-bottom: 32px; }
  h2 { font-size: 18px; margin-top: 28px; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; }
  h3 { font-size: 15px; }
  ul, ol { padding-left: 22px; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
  <div class="brand">AutomateIQ</div>
  <h1>${escapeHtml(proposal.title)}</h1>
  <div class="meta">Prepared for ${escapeHtml(company)} · ${date} · automateiq.ie</div>
  ${markdownToHtml(proposal.content)}
</body>
</html>`;

  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
