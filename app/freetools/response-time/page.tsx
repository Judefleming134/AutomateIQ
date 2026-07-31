import type { Metadata } from "next";
import { ToolAccent, ToolGives, ToolNext } from "@/components/tools/tool-extras";
import { Timer } from "lucide-react";
import { ResponseTimeTester } from "./tester";

export const metadata: Metadata = {
  title: "How fast do you actually reply? | Free test | AutomateIQ",
  description:
    "We send one realistic enquiry to the email published on your website and time how long it sits unopened. Free, honest, and usually a surprise.",
  alternates: { canonical: "https://automateiq.ie/freetools/response-time" },
  openGraph: {
    type: "website",
    url: "https://automateiq.ie/freetools/response-time",
    title: "How fast do you actually reply?",
    description: "A real enquiry, a real clock. Find out what a customer actually experiences.",
    siteName: "AutomateIQ",
    images: ["https://automateiq.ie/logo-aiq.png"],
  },
};

export default function ResponseTimePage() {
  return (
    <ToolAccent slug="response-time">
      <section className="book-hero">
        <p className="book-kicker">
          <Timer size={14} /> Free test
        </p>
        <h1>How fast do you actually reply?</h1>
        <p className="book-hero-sub">
          Not how fast you think you do. We&apos;ll send one realistic enquiry to the email
          published on your website and time how long it sits there unopened. That&apos;s
          the number your customers experience — and it&apos;s usually a shock.
        </p>
      </section>

      <ToolGives slug="response-time" />
      <section className="book-section" style={{ borderTop: "none", paddingTop: 0 }}>
        <ResponseTimeTester />
      </section>
      <ToolNext slug="response-time" />
    </ToolAccent>
  );
}
