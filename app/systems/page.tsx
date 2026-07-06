import Link from "next/link";
import type { Metadata } from "next";
import { Layers, ArrowRight, Sparkles, Puzzle, Wand2 } from "lucide-react";
import { SYSTEMS_CATALOG } from "@/lib/systems/catalog";
import { SystemCard } from "./system-card";

export const metadata: Metadata = {
  title: "Custom Business Systems | AutomateIQ",
  description:
    "AutomateIQ designs and develops completely bespoke, enterprise-grade software platforms built around the way your organisation works — from workforce and asset management to ERP, finance automation and AI logistics.",
  alternates: { canonical: "https://automateiq.ie/systems" },
  openGraph: {
    type: "website",
    url: "https://automateiq.ie/systems",
    title: "Custom Business Systems | AutomateIQ",
    description:
      "Bespoke enterprise software platforms designed around your business — not off-the-shelf software. See examples of the systems AutomateIQ builds.",
    siteName: "AutomateIQ",
    images: ["https://automateiq.ie/logo-aiq.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Custom Business Systems | AutomateIQ",
    description: "Bespoke enterprise software platforms designed around your business.",
  },
};

export default function SystemsPage() {
  return (
    <div className="book-page sys-page">
      <header className="book-topbar">
        <Link href="/" className="book-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-aiq.png" alt="AutomateIQ" />
        </Link>
        <a href="#book" className="btn btn-primary btn-sm">Book a strategy session</a>
      </header>

      {/* Hero / introduction */}
      <section className="book-hero">
        <p className="book-kicker"><Layers size={14} /> Custom Business Systems</p>
        <h1>Enterprise software, designed around your business</h1>
        <p className="book-hero-sub">
          Every business operates differently. Rather than forcing you to adapt to generic software,
          AutomateIQ designs and develops completely bespoke platforms tailored to the way your
          organisation actually works. The systems below are examples of what we can build and
          customise around you.
        </p>
        <div className="book-hero-cta">
          <a href="#systems" className="btn btn-primary">Explore the systems</a>
          <span className="book-hero-meta">Bespoke · Enterprise-grade · Built around your operation</span>
        </div>
      </section>

      {/* Positioning strip */}
      <section className="book-section" style={{ borderTop: "none", paddingTop: 8 }}>
        <div className="sys-pillars">
          <div className="sys-pillar">
            <span className="sys-pillar-icon"><Wand2 size={18} /></span>
            <h3>Designed, not configured</h3>
            <p>We architect each platform around your processes, data and people — never a template forced to fit.</p>
          </div>
          <div className="sys-pillar">
            <span className="sys-pillar-icon"><Puzzle size={18} /></span>
            <h3>Modular &amp; connected</h3>
            <p>Each system plugs into one connected core, sharing your AI Assistant, data and organisation.</p>
          </div>
          <div className="sys-pillar">
            <span className="sys-pillar-icon"><Sparkles size={18} /></span>
            <h3>Enterprise-grade, without the overhead</h3>
            <p>The capability of systems like SAP — shaped to your business, without the complexity or cost.</p>
          </div>
        </div>
      </section>

      {/* Showcase */}
      <section className="book-section" id="systems">
        <div className="book-section-head">
          <p className="book-eyebrow">System showcase</p>
          <h2>Examples of what we design and build</h2>
          <p className="book-lead" style={{ margin: "10px auto 0", maxWidth: 640 }}>
            These are examples of the types of enterprise software we can build and customise around
            your business — not off-the-shelf products. Every feature list is illustrative and fully
            tailored to your requirements.
          </p>
        </div>
        <div className="sys-grid">
          {SYSTEMS_CATALOG.map((s) => (
            <SystemCard key={s.key} system={s} />
          ))}
        </div>
      </section>

      {/* Bespoke assurance */}
      <section className="book-section">
        <div className="sys-bespoke panel">
          <h2>Every solution is bespoke</h2>
          <p>
            None of the above are fixed products. Each system is designed, expanded and integrated
            around your exact operational requirements — your workflows, your rules, your tools. If
            your business has a unique process or challenge, we build the platform around it.
          </p>
        </div>
      </section>

      {/* Final CTA */}
      <section className="book-section book-booking" id="book">
        <div className="sys-cta panel">
          <p className="book-eyebrow" style={{ textAlign: "center" }}>Let&apos;s design yours</p>
          <h2>Every organisation operates differently</h2>
          <p>
            If your business has a unique process, workflow or operational challenge, AutomateIQ can
            design and develop a completely bespoke enterprise platform around the way you work.
            Start with a free, no-obligation strategy session — we&apos;ll map exactly where a
            tailored system would create the most value.
          </p>
          <Link href="/book" className="btn btn-primary" style={{ padding: "14px 30px", fontSize: 15 }}>
            Book Your Free AI Strategy Session <ArrowRight size={16} />
          </Link>
        </div>
      </section>

      <footer className="book-footer">
        <Link href="/" className="book-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-aiq.png" alt="AutomateIQ" />
        </Link>
        <p>Bespoke enterprise software, designed around your business · automateiq.ie</p>
        <nav className="book-footer-nav">
          <Link href="/">Home</Link>
          <Link href="/agents.html">Agents</Link>
          <Link href="/book">Book a call</Link>
          <a href="https://www.instagram.com/auto__mateiq/" target="_blank" rel="noopener">Instagram</a>
        </nav>
      </footer>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Service",
            serviceType: "Custom business software development",
            provider: { "@type": "Organization", name: "AutomateIQ", url: "https://automateiq.ie" },
            areaServed: "IE",
            description:
              "AutomateIQ designs and develops bespoke, enterprise-grade software platforms tailored around each client's business, including workforce, asset, field service, compliance, ERP, finance, operations and logistics systems.",
          }),
        }}
      />
    </div>
  );
}
