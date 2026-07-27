import Link from "next/link";
import type { Metadata } from "next";
import { Sparkles, Map, Clock, ShieldCheck } from "lucide-react";
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

/**
 * The page is deliberately a straight line to a booked meeting: tight hero →
 * calendar → three take-aways → collapsed FAQ. The old layout put five
 * sections (nine-card grid, audience list, why-us) between the visitor and
 * the calendar — informative, but every scroll is a chance to bounce.
 */

const TAKEAWAYS = [
  {
    icon: <Map />,
    title: "Your opportunity map",
    body: "The specific places your business is losing time and money — and which AI fixes pay back first.",
  },
  {
    icon: <Clock />,
    title: "Real numbers",
    body: "A grounded estimate of the hours and euros each opportunity gives back.",
  },
  {
    icon: <ShieldCheck />,
    title: "A roadmap that's yours",
    body: "A staged plan you can act on with or without us — free, no obligation, no pressure.",
  },
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

      {/* Hero — one message, one action: pick a time below. */}
      <section className="book-hero">
        <p className="book-kicker"><Sparkles size={14} /> Free AI Strategy Session</p>
        <h1>Find out exactly where AI can save your business time and money</h1>
        <p className="book-hero-sub">
          One focused session. We map what&apos;s draining your week, put numbers
          on it, and hand you a clear roadmap — whether or not you ever work
          with us.
        </p>
        <div className="book-hero-cta">
          <a href="#booking" className="btn btn-primary">Pick your time below</a>
          <span className="book-hero-meta">{BOOKING_CONFIG.durationLabel} · Online · No cost, no obligation</span>
        </div>
      </section>

      {/* Booking — straight after the hero; the calendar IS the page. */}
      <section className="book-section book-booking" id="booking">
        <div className="book-section-head">
          <h2>Choose a time that suits you</h2>
          <p className="book-lead" style={{ margin: "10px auto 0", maxWidth: 620 }}>
            Instant confirmation by email. All times in {BOOKING_CONFIG.timezoneLabel}.
          </p>
        </div>
        <BookingWidget days={days} />
      </section>

      {/* What you leave with — the whole pitch in three cards. */}
      <section className="book-section">
        <div className="book-section-head">
          <p className="book-eyebrow">What you&apos;ll leave with</p>
          <h2>A strategy session — not a sales call</h2>
        </div>
        <div className="book-grid book-grid-3">
          {TAKEAWAYS.map((t) => (
            <div key={t.title} className="book-card book-card-feature panel">
              <span className="book-card-icon">{t.icon}</span>
              <h3>{t.title}</h3>
              <p>{t.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ — collapsed, for the few who want detail before committing. */}
      <section className="book-section">
        <div className="book-section-head">
          <p className="book-eyebrow">Questions</p>
          <h2>Anything you&apos;re wondering</h2>
        </div>
        <div className="book-faq">
          {FAQ.map((f) => (
            <details key={f.q} className="book-faq-item">
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
        <p style={{ textAlign: "center", marginTop: 28 }}>
          <a href="#booking" className="btn btn-primary">Book your free session</a>
        </p>
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
          <a href="https://www.instagram.com/auto__mateiq/" target="_blank" rel="noopener">Instagram</a>
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
