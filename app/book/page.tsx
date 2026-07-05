import Link from "next/link";
import type { Metadata } from "next";
import {
  Sparkles,
  ClipboardCheck,
  Gauge,
  Repeat,
  Workflow,
  Lightbulb,
  Clock,
  PiggyBank,
  Map,
  MessageCircleQuestion,
  Check,
  ShieldCheck,
  Target,
  Zap,
} from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateAvailability, BOOKING_CONFIG } from "@/lib/booking/slots";
import { BookingWidget } from "./booking-widget";

export const metadata: Metadata = {
  title: "Book Your Free AI Strategy Session | AutomateIQ",
  description:
    "A personalised, no-obligation consultation that identifies exactly where AI can save your business time and money — with a clear implementation roadmap. Book your free AI Strategy Session with AutomateIQ.",
  alternates: { canonical: "https://automateiq.ie/book" },
  openGraph: {
    type: "website",
    url: "https://automateiq.ie/book",
    title: "Book Your Free AI Strategy Session | AutomateIQ",
    description:
      "A personalised, no-obligation consultation to identify where AI can create measurable value for your business — with a clear roadmap. Not a generic sales call.",
    siteName: "AutomateIQ",
  },
  twitter: {
    card: "summary_large_image",
    title: "Book Your Free AI Strategy Session | AutomateIQ",
    description:
      "A personalised, no-obligation consultation to identify where AI can create measurable value for your business.",
  },
};

// Availability depends on live bookings, so render on request.
export const dynamic = "force-dynamic";

const COVER = [
  { icon: <ClipboardCheck />, title: "Review of current processes", body: "We walk through how your business runs day to day and where the friction is." },
  { icon: <Gauge />, title: "AI Readiness Assessment", body: "An honest read on where you are today and what's realistic to automate first." },
  { icon: <Repeat />, title: "Repetitive task audit", body: "We pinpoint the manual, repeated work quietly draining hours every week." },
  { icon: <Workflow />, title: "Automation opportunities", body: "The specific workflows where AI agents can take real work off your plate." },
  { icon: <Lightbulb />, title: "Implementation recommendations", body: "Concrete, prioritised suggestions — not vague 'AI could help' hand-waving." },
  { icon: <Clock />, title: "Estimated time savings", body: "A grounded estimate of the hours each opportunity could give back." },
  { icon: <PiggyBank />, title: "Estimated cost savings", body: "What those hours and efficiencies translate to in real money." },
  { icon: <Map />, title: "High-level roadmap", body: "A clear, staged plan for rolling AI into your business without disruption." },
  { icon: <MessageCircleQuestion />, title: "Your questions answered", body: "Time set aside for whatever you want to ask — no question too basic." },
];

const AUDIENCE = [
  "Small and medium businesses ready to work smarter",
  "Companies looking to reduce time spent on administration",
  "Businesses that want to improve day-to-day efficiency",
  "Teams seriously considering AI implementation",
  "Organisations looking to automate manual workflows",
];

const WHY = [
  { icon: <Target />, title: "A tailored strategy, not generic advice", body: "Every recommendation is built around your business, your processes and your numbers — not a template." },
  { icon: <Zap />, title: "Built by people who ship real AI", body: "AutomateIQ runs a live platform of working AI agents. You get practical guidance from people who build this every day." },
  { icon: <ShieldCheck />, title: "No pressure, no obligation", body: "The value is in the roadmap you walk away with. Whether you build with us or not is entirely up to you." },
];

const FAQ = [
  { q: "How long does the session last?", a: `Around ${BOOKING_CONFIG.durationLabel}. Enough time to properly understand your business and give you real, actionable recommendations without wasting your day.` },
  { q: "Is it really free?", a: "Yes — completely free, with no hidden cost. It's how we show the value of working with AutomateIQ before you commit to anything." },
  { q: "Is there any obligation?", a: "None at all. You're free to take the roadmap and act on it yourself. There's no contract and no pressure to buy." },
  { q: "What happens afterwards?", a: "You'll receive a clear summary of the opportunities we identified and a suggested roadmap. If you'd like us to implement any of it, we'll outline exactly how — but that's your call." },
  { q: "Do I need technical knowledge?", a: "Not in the slightest. We handle the technical side. You just bring an understanding of how your business works today." },
  { q: "How should I prepare?", a: "Have a rough idea of the manual or repetitive tasks that take up the most time. That's all — we'll guide the rest of the conversation." },
];

export default async function BookPage() {
  const supabase = createAdminClient();

  // Remove slots already held by an active booking. Falls back to an empty
  // calendar-with-no-removals if the table doesn't exist yet (0010 not run).
  const taken = new Set<string>();
  const { data: rows } = await supabase
    .from("strategy_bookings")
    .select("slot_at, status")
    .in("status", ["pending", "confirmed", "rescheduled"])
    .gte("slot_at", new Date().toISOString());
  for (const r of rows ?? []) {
    taken.add(new Date(r.slot_at).toISOString());
  }

  const days = generateAvailability(new Date(), taken);

  return (
    <div className="book-page">
      <header className="book-topbar">
        <Link href="/" className="book-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-aiq.png" alt="AutomateIQ" />
        </Link>
        <a href="#booking" className="btn btn-primary btn-sm">Book your session</a>
      </header>

      {/* Hero */}
      <section className="book-hero">
        <p className="book-kicker"><Sparkles size={14} /> Free AI Strategy Session</p>
        <h1>Find out exactly where AI can save your business time and money</h1>
        <p className="book-hero-sub">
          A personalised, no-obligation consultation with AutomateIQ. We map the repetitive work
          draining your week, show you what AI can take off your plate, and hand you a clear
          roadmap — whether or not you ever work with us.
        </p>
        <div className="book-hero-cta">
          <a href="#booking" className="btn btn-primary">Book your free session</a>
          <span className="book-hero-meta">{BOOKING_CONFIG.durationLabel} · Online · No cost, no obligation</span>
        </div>
      </section>

      {/* About */}
      <section className="book-section">
        <div className="book-section-head">
          <h2>This is a strategy session — not a sales call</h2>
        </div>
        <p className="book-lead">
          Most &ldquo;AI consultations&rdquo; are a thinly disguised pitch. This isn&apos;t that.
          The AI Strategy Session is a genuine working session designed to identify how AI can
          create <strong>measurable</strong> value in your specific business. We look at how you
          actually operate, find the opportunities with the highest return, and give you an honest
          assessment you can act on immediately. You leave with clarity and a plan — the decision
          about what to do next is entirely yours.
        </p>
      </section>

      {/* What we'll cover */}
      <section className="book-section">
        <div className="book-section-head">
          <p className="book-eyebrow">What we&apos;ll cover</p>
          <h2>Everything you get in one focused session</h2>
        </div>
        <div className="book-grid">
          {COVER.map((c) => (
            <div key={c.title} className="book-card panel">
              <span className="book-card-icon">{c.icon}</span>
              <h3>{c.title}</h3>
              <p>{c.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Who it's for */}
      <section className="book-section">
        <div className="book-split">
          <div>
            <p className="book-eyebrow">Who it&apos;s for</p>
            <h2>Built for businesses ready to work smarter</h2>
            <p className="book-lead" style={{ marginTop: 12 }}>
              If any of these sound like you, the session will be time well spent.
            </p>
          </div>
          <ul className="book-check-list">
            {AUDIENCE.map((a) => (
              <li key={a}><span className="book-check"><Check size={14} /></span>{a}</li>
            ))}
          </ul>
        </div>
      </section>

      {/* Why AutomateIQ */}
      <section className="book-section">
        <div className="book-section-head">
          <p className="book-eyebrow">Why book with AutomateIQ</p>
          <h2>A tailored AI strategy beats generic AI advice</h2>
        </div>
        <div className="book-grid book-grid-3">
          {WHY.map((w) => (
            <div key={w.title} className="book-card book-card-feature panel">
              <span className="book-card-icon">{w.icon}</span>
              <h3>{w.title}</h3>
              <p>{w.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="book-section">
        <div className="book-section-head">
          <p className="book-eyebrow">Frequently asked questions</p>
          <h2>Everything you might be wondering</h2>
        </div>
        <div className="book-faq">
          {FAQ.map((f) => (
            <details key={f.q} className="book-faq-item">
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Booking */}
      <section className="book-section book-booking" id="booking">
        <div className="book-section-head">
          <p className="book-eyebrow">Book your session</p>
          <h2>Choose a time that suits you</h2>
          <p className="book-lead" style={{ margin: "10px auto 0", maxWidth: 620 }}>
            Pick a slot below and tell us a little about your business. You&apos;ll get an instant
            confirmation by email. All times shown in {BOOKING_CONFIG.timezoneLabel}.
          </p>
        </div>
        <BookingWidget days={days} />
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
          <Link href="/privacy.html">Privacy</Link>
        </nav>
      </footer>

      {/* Structured data — helps the session show up as an event/service. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Service",
            serviceType: "AI Strategy Session",
            provider: { "@type": "Organization", name: "AutomateIQ", url: "https://automateiq.ie" },
            areaServed: "IE",
            description:
              "A free, personalised AI Strategy Session identifying where AI can create measurable time and cost savings for your business, with a high-level implementation roadmap.",
            offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
          }),
        }}
      />
    </div>
  );
}
