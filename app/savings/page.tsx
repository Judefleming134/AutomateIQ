import Link from "next/link";
import type { Metadata } from "next";
import { Calculator, ShieldCheck, SlidersHorizontal, LineChart } from "lucide-react";
import { SavingsCalculator } from "./calculator";

export const metadata: Metadata = {
  title: "Savings Calculator | AutomateIQ",
  description:
    "See what AutomateIQ's AI agents and systems would be worth to your business — revenue recovered, costs saved and hours freed every week. Quick 30-second estimate, or add your real numbers for a detailed analysis.",
  alternates: { canonical: "https://automateiq.ie/savings" },
  openGraph: {
    type: "website",
    url: "https://automateiq.ie/savings",
    title: "Savings Calculator | AutomateIQ",
    description:
      "See what AI agents would be worth to your business — in euros and hours, not buzzwords.",
    siteName: "AutomateIQ",
    images: ["https://automateiq.ie/logo-aiq.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Savings Calculator | AutomateIQ",
    description: "See what AI agents would be worth to your business.",
  },
};

export default function SavingsPage() {
  return (
    <div className="book-page sv-page">
      <header className="book-topbar">
        <Link href="/" className="book-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-aiq.png" alt="AutomateIQ" />
        </Link>
        <Link href="/book" className="btn btn-primary btn-sm">Book a strategy session</Link>
      </header>

      <section className="book-hero">
        <p className="book-kicker"><Calculator size={14} /> Savings Calculator</p>
        <h1>What would your AI workforce be worth?</h1>
        <p className="book-hero-sub">
          Put real numbers on it. This calculator models what AutomateIQ&apos;s agents and systems
          would recover and save in your business — in euros and hours, not buzzwords. Start with
          four quick questions, then add your real figures for a far more accurate picture.
        </p>
      </section>

      <section className="book-section" style={{ borderTop: "none", paddingTop: 0 }}>
        <SavingsCalculator />
      </section>

      {/* How the model works — credibility for the strategy call */}
      <section className="book-section">
        <div className="sys-pillars">
          <div className="sys-pillar">
            <span className="sys-pillar-icon"><SlidersHorizontal size={18} /></span>
            <h3>Built on our real agents</h3>
            <p>
              Every line maps to a live AutomateIQ capability — Speed-to-Lead, reviews, instant
              quoting, AI admin, collections, content and logistics — not a made-up multiplier.
            </p>
          </div>
          <div className="sys-pillar">
            <span className="sys-pillar-icon"><ShieldCheck size={18} /></span>
            <h3>Deliberately conservative</h3>
            <p>
              We use cautious recovery and automation rates throughout. If anything, the number on
              the right underestimates what a well-run rollout returns.
            </p>
          </div>
          <div className="sys-pillar">
            <span className="sys-pillar-icon"><LineChart size={18} /></span>
            <h3>Rebuilt live on your call</h3>
            <p>
              Bring your estimate to a free strategy session and we&apos;ll rebuild it line by line
              from your actual figures — and show exactly which agents deliver it.
            </p>
          </div>
        </div>
      </section>

      <footer className="book-footer">
        <Link href="/" className="book-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-aiq.png" alt="AutomateIQ" />
        </Link>
        <p>AI agents that run your business operations · automateiq.ie</p>
        <nav className="book-footer-nav">
          <Link href="/">Home</Link>
          <Link href="/agents.html">Agents</Link>
          <Link href="/book">Book a call</Link>
          <a href="https://www.instagram.com/auto__mateiq/" target="_blank" rel="noopener">Instagram</a>
        </nav>
      </footer>
    </div>
  );
}
