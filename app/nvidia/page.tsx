import Link from "next/link";
import type { Metadata } from "next";
import { Cpu, ArrowRight, ArrowLeft, Layers, Network, Plug, Boxes, BrainCircuit, TrendingUp } from "lucide-react";
import { NvidiaVideo } from "./nvidia-video";

export const metadata: Metadata = {
  title: "The AI Operating System | AutomateIQ",
  description:
    "NVIDIA's Jensen Huang describes a future where AI becomes the operating system of business — one layer coordinating specialised AI agents. It's exactly what AutomateIQ has built.",
  alternates: { canonical: "https://automateiq.ie/nvidia" },
  openGraph: {
    type: "website",
    url: "https://automateiq.ie/nvidia",
    title: "The AI Operating System | AutomateIQ",
    description:
      "The future is an AI Operating System coordinating specialised AI agents — and AutomateIQ has already built it.",
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
        <p className="book-kicker"><Cpu size={14} /> The AI Operating System</p>
        <h1>The AI era, in their own words</h1>
        <p className="book-hero-sub">
          NVIDIA&apos;s Jensen Huang lays out where business is heading: AI becoming the operating
          system of the enterprise — one intelligent layer coordinating specialised agents across an
          entire operation. Press play, then see how AutomateIQ has already built exactly that.
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

      {/* Bridge to AutomateIQ — the AI Operating System */}
      <section className="book-section nv-bridge">
        <div className="nv-os panel">
          <p className="nv-os-kicker">The same vision — already built</p>
          <h2>The future of business is an AI Operating System</h2>
          <p className="nv-os-lead">
            One intelligent layer coordinating specialised AI agents across your whole operation.
            That&apos;s the shift being described — and it&apos;s what AutomateIQ has already built.
          </p>

          <div className="nv-os-grid">
            <div className="nv-os-point">
              <span className="nv-os-i"><Layers size={18} /></span>
              <div><h3>One operating layer</h3><p>Specialised AI agents orchestrated through a single intelligent operating system.</p></div>
            </div>
            <div className="nv-os-point">
              <span className="nv-os-i"><Network size={18} /></span>
              <div><h3>A coordinated workforce</h3><p>Each agent handles its speciality; the OS coordinates them so nothing works in isolation.</p></div>
            </div>
            <div className="nv-os-point">
              <span className="nv-os-i"><Plug size={18} /></span>
              <div><h3>Integrates, never replaces</h3><p>We connect to your existing software, APIs and enterprise tools instead of ripping them out.</p></div>
            </div>
            <div className="nv-os-point">
              <span className="nv-os-i"><Boxes size={18} /></span>
              <div><h3>Bespoke, not one-size-fits-all</h3><p>Every system is designed around your workflows, processes and objectives.</p></div>
            </div>
            <div className="nv-os-point">
              <span className="nv-os-i"><BrainCircuit size={18} /></span>
              <div><h3>Leading models, our orchestration</h3><p>The best modern large language models, combined with our own workflows and operating system.</p></div>
            </div>
            <div className="nv-os-point">
              <span className="nv-os-i"><TrendingUp size={18} /></span>
              <div><h3>Evolves with you</h3><p>Continuously adapts and optimises for virtually any industry or business.</p></div>
            </div>
          </div>

          <Link href="/book" className="btn btn-primary nv-os-cta">
            Book Your Free AI Strategy Session <ArrowRight size={16} />
          </Link>
          <p className="nv-os-note">
            AutomateIQ is independent and not affiliated with, sponsored by, or endorsed by NVIDIA.
            The presentation reflects NVIDIA&apos;s own view of the AI era.
          </p>
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
