import type { Metadata } from "next";
import Link from "next/link";
import { decodeQuoteConfig } from "@/lib/tools/quote-config";
import { QuoteWidget } from "@/app/freetools/quote-builder/widget";

export const metadata: Metadata = {
  title: "Instant quote",
  // Embedded copies must never compete with the host site in search results.
  robots: { index: false, follow: false },
};

/**
 * The standalone widget, sized for an iframe on someone else's website.
 *
 * Deliberately has no AutomateIQ header, nav or footer — it's rendering inside
 * a plumber's site, not ours. Just the widget and one small credit line.
 */
export default async function QuoteEmbedPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const { c } = await searchParams;
  const config = c ? decodeQuoteConfig(c) : null;

  if (!config) {
    return (
      <div style={{ padding: 24, fontSize: 14 }}>
        <strong>This quote form isn&apos;t set up yet.</strong>
        <p style={{ color: "var(--faint)", marginTop: 6 }}>
          The link is missing its settings, or they&apos;ve been changed since it was
          copied.{" "}
          <Link href="/freetools/quote-builder" target="_blank">
            Build a new one here
          </Link>{" "}
          — it takes two minutes and it&apos;s free.
        </p>
      </div>
    );
  }

  return (
    <div style={{ padding: 16, maxWidth: 560, margin: "0 auto" }}>
      <QuoteWidget config={config} embedded />
    </div>
  );
}
