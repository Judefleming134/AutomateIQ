import { readFile } from "node:fs/promises";
import path from "node:path";

// Purely static content (public/index.html) — pre-render at build time
// instead of re-reading the file on every request.
export const dynamic = "force-static";

/**
 * Next.js App Router does not automatically serve public/index.html at "/" —
 * a bare "/" request is owned by App Router's own resolution and 404s
 * without an explicit handler. This root Route Handler returns the marketing
 * site's exact HTML bytes with no React rendering/hydration involved, so the
 * existing static site keeps rendering byte-identical at the site's actual
 * root URL instead of relying on a Vercel rewrite (whose precedence against
 * an active Next.js framework preset isn't guaranteed).
 */
export async function GET() {
  const filePath = path.join(process.cwd(), "public", "index.html");
  const html = await readFile(filePath, "utf-8");
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
