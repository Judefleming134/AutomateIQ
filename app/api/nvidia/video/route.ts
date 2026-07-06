import { NextResponse } from "next/server";

/**
 * Resolves the NVIDIA reel's direct video URL from Instagram's public page
 * metadata (the same og:video / video_url a link-unfurler reads) and redirects
 * to it, so the /nvidia phone can play a clean native <video> with no Instagram
 * UI — and nobody has to download anything. Cached briefly because Instagram's
 * CDN URLs are signed and time-limited. On any failure it 404s, and the client
 * falls back to the Instagram embed.
 */

const REEL_URL = "https://www.instagram.com/reel/DZ7y_MiiqI3/";

// Revalidate every 15 min — long enough to avoid hammering Instagram, short
// enough that a signed CDN URL is refreshed before it expires.
export const revalidate = 900;

function decode(u: string): string {
  return u
    .replace(/\\u0026/g, "&")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&")
    .replace(/\\/g, "");
}

function extractVideoUrl(html: string): string | null {
  // 1) Open Graph video meta (most reliable for public reels).
  const og =
    /<meta[^>]+property=["']og:video(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i.exec(html) ||
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:video(?::secure_url)?["']/i.exec(html);
  if (og?.[1]) return decode(og[1]);

  // 2) Embedded JSON fallback.
  const json = /"video_url":"(https:\\?\/\\?\/[^"]+)"/i.exec(html);
  if (json?.[1]) return decode(json[1]);

  return null;
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      next: { revalidate },
    });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    // Try the reel page, then its embed page — one of the two usually carries
    // the direct video URL for a public reel.
    for (const target of [REEL_URL, `${REEL_URL}embed/`]) {
      const html = await fetchHtml(target);
      if (!html) continue;
      const url = extractVideoUrl(html);
      if (url && /^https:\/\//.test(url)) {
        return NextResponse.redirect(url, {
          status: 302,
          headers: { "Cache-Control": "public, max-age=300, s-maxage=900" },
        });
      }
    }
    return NextResponse.json({ error: "no video" }, { status: 404 });
  } catch (err) {
    console.error("NVIDIA reel resolve failed:", err);
    return NextResponse.json({ error: "resolve failed" }, { status: 404 });
  }
}
