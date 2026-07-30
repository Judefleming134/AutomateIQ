import type { Metadata } from "next";
import { PhoneMissed } from "lucide-react";
import { MissedCallsCalculator } from "./calculator";

export const metadata: Metadata = {
  title: "What are missed calls costing you? | Free calculator | AutomateIQ",
  description:
    "Work out in euro what unanswered calls, texts and enquiries cost your business every week, month and year. Free, no signup, your numbers only.",
  alternates: { canonical: "https://automateiq.ie/tools/missed-calls" },
  openGraph: {
    type: "website",
    url: "https://automateiq.ie/tools/missed-calls",
    title: "What are missed calls costing you?",
    description: "Free calculator — put a real euro figure on the enquiries nobody got back to.",
    siteName: "AutomateIQ",
    images: ["https://automateiq.ie/logo-aiq.png"],
  },
};

export default function MissedCallsPage() {
  return (
    <>
      <section className="book-hero">
        <p className="book-kicker">
          <PhoneMissed size={14} /> Free calculator
        </p>
        <h1>What are missed enquiries actually costing you?</h1>
        <p className="book-hero-sub">
          Four numbers you already know, and you&apos;ll have a euro figure for the work
          that quietly goes to whoever answered first. No signup, nothing stored, and
          the maths is shown so you can argue with it.
        </p>
      </section>
      <section className="book-section" style={{ borderTop: "none", paddingTop: 0 }}>
        <MissedCallsCalculator />
      </section>
    </>
  );
}
