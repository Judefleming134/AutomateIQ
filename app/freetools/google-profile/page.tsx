import type { Metadata } from "next";
import { MapPin } from "lucide-react";
import { gbpConfigured } from "@/lib/tools/gbp";
import { GbpChecker } from "./checker";

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
    <>
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
      <section className="book-section" style={{ borderTop: "none", paddingTop: 0 }}>
        <GbpChecker configured={gbpConfigured()} />
      </section>
    </>
  );
}
