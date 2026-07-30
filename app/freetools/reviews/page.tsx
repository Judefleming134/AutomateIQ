import type { Metadata } from "next";
import { MessageSquareQuote } from "lucide-react";
import { ReviewReplyGenerator } from "./generator";

export const metadata: Metadata = {
  title: "Free review reply writer | AutomateIQ",
  description:
    "Paste a Google or Facebook review and get three replies written for you — warm, professional, or firm but fair. Free, no signup. Never argue with a reviewer again.",
  alternates: { canonical: "https://automateiq.ie/freetools/reviews" },
  openGraph: {
    type: "website",
    url: "https://automateiq.ie/freetools/reviews",
    title: "Free review reply writer",
    description: "Three ready-to-post replies to any review, written the way a real person would.",
    siteName: "AutomateIQ",
    images: ["https://automateiq.ie/logo-aiq.png"],
  },
};

export default function ReviewsPage() {
  return (
    <>
      <section className="book-hero">
        <p className="book-kicker">
          <MessageSquareQuote size={14} /> Free tool
        </p>
        <h1>What do you say to a bad review?</h1>
        <p className="book-hero-sub">
          Paste it in and you&apos;ll get three replies — warm, professional, or firm but
          fair. Written the way a real person talks, never defensive, and never claiming
          anything that can&apos;t be stood over. Free, no signup.
        </p>
      </section>
      <section className="book-section" style={{ borderTop: "none", paddingTop: 0 }}>
        <ReviewReplyGenerator />
      </section>
    </>
  );
}
