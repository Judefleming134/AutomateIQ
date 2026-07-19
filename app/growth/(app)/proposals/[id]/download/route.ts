import { requireGrowth } from "@/lib/growth/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { escapeHtml, markdownToHtml } from "@/lib/growth/markdown";

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
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #1a1d24; max-width: 720px; margin: 0 auto; padding: 0 28px 48px; line-height: 1.65; font-size: 15px; }
  .masthead { background: #0b0f17; margin: 0 -28px 26px; padding: 18px 28px; border-bottom: 3px solid #3B82F6; display: flex; align-items: center; }
  .masthead img { height: 28px; width: auto; }
  .masthead .wordmark { display: none; color: #fff; font-family: 'Helvetica Neue', Arial, sans-serif; font-weight: 800; font-size: 20px; letter-spacing: -0.01em; }
  h1 { font-size: 26px; margin: 8px 0 2px; }
  .meta { color: #6b7280; font-size: 13px; margin-bottom: 32px; }
  h2 { font-size: 18px; margin-top: 28px; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; }
  h3 { font-size: 15px; }
  ul, ol { padding-left: 22px; }
</style>
</head>
<body>
  <div class="masthead"><img src="https://automateiq.ie/logo-aiq.png" alt="AutomateIQ" onerror="this.style.display='none';this.nextElementSibling.style.display='inline'"/><span class="wordmark">AutomateIQ</span></div>
  <h1>${escapeHtml(proposal.title)}</h1>
  <div class="meta">${[
    company ? `Prepared for ${escapeHtml(company)}` : "",
    date,
    "automateiq.ie",
  ]
    .filter(Boolean)
    .join(" · ")}</div>
  ${markdownToHtml(proposal.content)}
</body>
</html>`;

  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
