import type { Metadata } from "next";
import { Calculator } from "lucide-react";
import { QuoteBuilder } from "./builder";

export const metadata: Metadata = {
  title: "Free instant quote widget for your website | AutomateIQ",
  description:
    "Build a quote calculator for your own website in two minutes. No signup, no account, no monthly fee — set your prices, copy the code, paste it on your site.",
  alternates: { canonical: "https://automateiq.ie/tools/quote-builder" },
  openGraph: {
    type: "website",
    url: "https://automateiq.ie/tools/quote-builder",
    title: "Free instant quote widget for your website",
    description: "Set your prices, copy the code, paste it on your site. No signup.",
    siteName: "AutomateIQ",
    images: ["https://automateiq.ie/logo-aiq.png"],
  },
};

export default function QuoteBuilderPage() {
  return (
    <>
      <section className="book-hero">
        <p className="book-kicker">
          <Calculator size={14} /> Free tool
        </p>
        <h1>Give people a price before they leave your site</h1>
        <p className="book-hero-sub">
          Most people asking for a quote have three tabs open. The one who gets a number
          first usually gets the job. Set your prices below, copy the code, paste it on
          your website — no signup, no account, no monthly fee.
        </p>
      </section>
      <section className="book-section" style={{ borderTop: "none", paddingTop: 0 }}>
        <QuoteBuilder />
      </section>
    </>
  );
}
