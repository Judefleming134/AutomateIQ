import type { Metadata } from "next";
import { ToolAccent, ToolGives, ToolNext } from "@/components/tools/tool-extras";
import { MapPin } from "lucide-react";
import { gbpConfigured } from "@/lib/tools/gbp";
import { GbpChecker } from "./checker";

/**
 * `noindex` while the checker is off.
 *
 * This page was in the sitemap the whole time it was returning "not switched
 * on yet", so Google was being told to send people searching for exactly this
 * problem to a dead end. Being ranked for a page that can't help is worse than
 * not being found at all. Both this and the sitemap entry come back on their
 * own the moment GOOGLE_PLACES_API_KEY is set — nothing to remember.
 */
export async function generateMetadata(): Promise<Metadata> {
  if (gbpConfigured()) return metadata;
  return { ...metadata, robots: { index: false, follow: true } };
}

const metadata: Metadata = {
  title: "Free Google Business Profile check | AutomateIQ",
  description:
    "See why your business isn't showing in the Google map pack. Free check of your reviews, rating, hours, category and phone — with the one fix that matters most.",
  alternates: { canonical: "https://automateiq.ie/freetools/google-profile" },
  openGraph: {
    type: "website",
    url: "https://automateiq.ie/freetools/google-profile",
    title: "Free Google Business Profile check",
    description: "Why aren't you in the map pack? Free check, one clear fix.",
    siteName: "AutomateIQ",
    images: ["https://automateiq.ie/logo-aiq.png"],
  },
};

export default function GoogleProfilePage() {
  return (
    <ToolAccent slug="google-profile">
      <section className="book-hero">
        <p className="book-kicker">
          <MapPin size={14} /> Free check
        </p>
        <h1>Why aren&apos;t you in the map pack?</h1>
        <p className="book-hero-sub">
          For a local trade, your Google Business Profile decides more of your phone calls
          than your website does. This checks the handful of things that actually move it
          — and tells you which one to fix first.
        </p>
      </section>

      <ToolGives slug="google-profile" />
      <section className="book-section" style={{ borderTop: "none", paddingTop: 0 }}>
        <GbpChecker configured={gbpConfigured()} />
      </section>
      <ToolNext slug="google-profile" />
    </ToolAccent>
  );
}
