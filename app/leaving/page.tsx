import Link from "next/link";
import type { Metadata } from "next";
import { ExternalLink, ShieldAlert } from "lucide-react";
import { readToken } from "@/lib/tools/token";

export const metadata: Metadata = {
  title: "Leaving AutomateIQ",
  robots: { index: false, follow: false },
};

/** Long enough that a review email clicked a fortnight later still works. */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The interstitial for a review link that doesn't point at a known review
 * platform.
 *
 * It exists so automateiq.ie can never be used to vouch for an arbitrary
 * destination. The visitor is told plainly where they're going and has to
 * choose to continue — nothing auto-redirects, and the link carries
 * rel="noopener noreferrer nofollow" so the destination gains neither a
 * window handle nor any SEO value from sitting behind our domain.
 *
 * The `t` parameter is signed by /api/r/[token]. A hand-crafted URL simply
 * fails verification, so this page can't be turned into the open redirect it
 * was built to prevent.
 */
export default async function LeavingPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const { t } = await searchParams;
  const payload = t ? readToken<{ t: number; to: string }>(t, MAX_AGE_MS) : null;

  let destination: URL | null = null;
  if (payload?.to) {
    try {
      const parsed = new URL(payload.to);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        destination = parsed;
      }
    } catch {
      destination = null;
    }
  }

  return (
    <div className="book-page sv-page">
      <section className="book-hero">
        <p className="book-kicker">
          <ShieldAlert size={14} /> Leaving AutomateIQ
        </p>
        {destination ? (
          <>
            <h1>You&apos;re about to leave our site</h1>
            <p className="book-hero-sub">
              This review link points somewhere we don&apos;t recognise as a review
              platform, so we&apos;re showing you where it goes rather than sending you
              there automatically.
            </p>
          </>
        ) : (
          <>
            <h1>That link has expired</h1>
            <p className="book-hero-sub">
              Review links are only good for a few weeks. Ask the business for a fresh
              one.
            </p>
          </>
        )}
      </section>

      <section className="book-section" style={{ borderTop: "none", paddingTop: 0 }}>
        {destination ? (
          <div className="panel panel-block">
            <p className="aseo-block-label">Destination</p>
            <p
              style={{
                fontSize: 16,
                fontWeight: 600,
                wordBreak: "break-all",
                margin: "0 0 4px",
              }}
            >
              {destination.hostname}
            </p>
            <p style={{ fontSize: 12.5, color: "var(--faint)", wordBreak: "break-all" }}>
              {destination.toString()}
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
              <a
                href={destination.toString()}
                rel="noopener noreferrer nofollow"
                className="btn btn-primary"
              >
                Continue to {destination.hostname} <ExternalLink size={13} />
              </a>
              <Link href="/" className="btn btn-secondary">
                No thanks
              </Link>
            </div>
          </div>
        ) : (
          <Link href="/" className="btn btn-primary">
            Go to AutomateIQ
          </Link>
        )}
      </section>
    </div>
  );
}
