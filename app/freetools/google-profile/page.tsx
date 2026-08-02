import type { Metadata } from "next";
import { ToolAccent, ToolGives, ToolNext } from "@/components/tools/tool-extras";
import { MapPin } from "lucide-react";
import { gbpConfigured } from "@/lib/tools/gbp";
import { GbpChecker } from "./checker";

/**
 * Indexable again — the page has something to say now.
 *
 * It used to be `noindex` whenever GOOGLE_PLACES_API_KEY was missing, because
 * it rendered "not switched on yet" and being ranked for a page that can't
 * help is worse than not being found at all. That guard was right for what the
 * page was. The self-check (J1) means there is no off state left to hide: with
 * a key it looks you up, without one it asks you seven questions, and both
 * produce the same scored report. Nothing here is gated any more.
 */

export const metadata: Metadata = {
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
          — and tells you which one to fix first. No sign-up, no email needed.
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
