import Link from "next/link";
import type { Metadata } from "next";
import { Cpu, ArrowRight, ArrowLeft } from "lucide-react";
import { NvidiaVideo } from "./nvidia-video";

export const metadata: Metadata = {
  title: "Explore NVIDIA's Vision | AutomateIQ",
  description:
    "NVIDIA's vision for the AI era — accelerated computing reshaping every industry. Watch the presentation and see how AutomateIQ puts that same intelligence to work in your business.",
  alternates: { canonical: "https://automateiq.ie/nvidia" },
  openGraph: {
    type: "website",
    url: "https://automateiq.ie/nvidia",
    title: "Explore NVIDIA's Vision | AutomateIQ",
    description:
      "NVIDIA's vision for the AI era — and how AutomateIQ puts that intelligence to work in your business.",
    siteName: "AutomateIQ",
  },
};

export default function NvidiaPage() {
  return (
    <div className="book-page nv-page">
      <header className="book-topbar">
        <Link href="/" className="book-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-aiq.png" alt="AutomateIQ" />
        </Link>
        <Link href="/" className="btn btn-secondary btn-sm">
          <ArrowLeft size={14} /> Back
        </Link>
      </header>

      <section className="book-hero nv-hero">
        <p className="book-kicker"><Cpu size={14} /> NVIDIA&apos;s Vision</p>
        <h1>The AI era, in their own words</h1>
        <p className="book-hero-sub">
          NVIDIA is powering a new industrial revolution — accelerated computing and AI reshaping
          every industry on earth. Watch the presentation below, then see how AutomateIQ puts that
          same intelligence to work inside your business.
        </p>
      </section>

      {/* Phone centrepiece */}
      <section className="nv-stage">
        <div className="nv-ambient" aria-hidden="true">
          <span className="nv-orb nv-orb-a" />
          <span className="nv-orb nv-orb-b" />
          <span className="nv-glow" />
        </div>

        <div className="nv-phone">
          <div className="nv-phone-frame">
            <span className="nv-island" />
            <div className="nv-screen">
              <NvidiaVideo />
            </div>
          </div>
          <span className="nv-btn nv-btn-power" aria-hidden="true" />
          <span className="nv-btn nv-btn-vol-up" aria-hidden="true" />
          <span className="nv-btn nv-btn-vol-dn" aria-hidden="true" />
          <span className="nv-btn nv-btn-mute" aria-hidden="true" />
        </div>

        <p className="nv-caption">Press play to watch the presentation.</p>
      </section>

      {/* Bridge to AutomateIQ */}
      <section className="book-section nv-bridge">
        <div className="sys-bespoke panel">
          <h2>From vision to your business</h2>
          <p>
            The same AI shift NVIDIA describes is what AutomateIQ builds around your operation —
            specialist AI agents and bespoke enterprise systems that do real work, on one connected
            platform. Book a free strategy session and we&apos;ll map exactly where it fits.
          </p>
          <Link href="/book" className="btn btn-primary" style={{ marginTop: 18, padding: "13px 28px" }}>
            Book Your Free AI Strategy Session <ArrowRight size={16} />
          </Link>
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
          <Link href="/systems">Systems</Link>
          <Link href="/book">Book a call</Link>
        </nav>
      </footer>
    </div>
  );
}
