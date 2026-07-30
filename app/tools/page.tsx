import Link from "next/link";
import type { Metadata } from "next";
import {
  ArrowRight,
  Calculator,
  MapPin,
  MessageSquareQuote,
  PhoneMissed,
  Search,
  Timer,
} from "lucide-react";

export const metadata: Metadata = {
  title: "Free tools for Irish businesses | AutomateIQ",
  description:
    "Six free tools, no signup: check your website's SEO, your Google Business Profile, how fast you really reply, what missed calls cost you, reply to reviews, and add instant quotes to your site.",
  alternates: { canonical: "https://automateiq.ie/tools" },
  openGraph: {
    type: "website",
    url: "https://automateiq.ie/tools",
    title: "Free tools for Irish businesses",
    description: "No signup, no email required, genuinely free. Built for trades and local businesses.",
    siteName: "AutomateIQ",
    images: ["https://automateiq.ie/logo-aiq.png"],
  },
};

const TOOLS = [
  {
    href: "/autoseo",
    icon: Search,
    title: "Website SEO check",
    blurb:
      "Why your site doesn't come up on Google — with the exact code to fix it, pre-filled with your own details.",
    time: "20 seconds",
  },
  {
    href: "/tools/google-profile",
    icon: MapPin,
    title: "Google Business Profile check",
    blurb:
      "The half that decides the map pack: reviews, rating, hours, category. Tells you which one to fix first.",
    time: "10 seconds",
  },
  {
    href: "/tools/response-time",
    icon: Timer,
    title: "How fast do you reply?",
    blurb:
      "We send one realistic enquiry to your published email and time how long it sits unopened. Usually a shock.",
    time: "1 minute",
  },
  {
    href: "/tools/missed-calls",
    icon: PhoneMissed,
    title: "What missed calls cost you",
    blurb:
      "Four numbers you already know, and a euro figure for the work going to whoever answered first.",
    time: "30 seconds",
  },
  {
    href: "/tools/reviews",
    icon: MessageSquareQuote,
    title: "Review reply writer",
    blurb:
      "Paste any review, get three replies — warm, professional, or firm but fair. Never defensive.",
    time: "15 seconds",
  },
  {
    href: "/tools/quote-builder",
    icon: Calculator,
    title: "Instant quote widget",
    blurb:
      "Build a quote calculator for your own website. Set your prices, copy the code, paste it in. No account.",
    time: "2 minutes",
  },
];

export default function ToolsHubPage() {
  return (
    <>
      <section className="book-hero">
        <p className="book-kicker">Free tools</p>
        <h1>Six things you can check right now, for nothing</h1>
        <p className="book-hero-sub">
          No signup, no email required, no report held back until you book a call. If they
          show you something worth fixing, fix it yourself — the instructions are right
          there. If you&apos;d rather we did it, you know where we are.
        </p>
      </section>

      <section className="book-section" style={{ borderTop: "none", paddingTop: 0 }}>
        <div className="aseo-next">
          {TOOLS.map((t) => {
            const Icon = t.icon;
            return (
              <Link
                key={t.href}
                href={t.href}
                className="aseo-next-card"
                style={{ textDecoration: "none", color: "inherit", display: "block" }}
              >
                <span
                  className="sys-pillar-icon"
                  style={{ display: "inline-flex", marginBottom: 10 }}
                  aria-hidden
                >
                  <Icon size={18} />
                </span>
                <strong style={{ fontSize: 16 }}>{t.title}</strong>
                <span style={{ display: "block", marginBottom: 8 }}>{t.blurb}</span>
                <span style={{ color: "var(--ac2, #3b82f6)", fontWeight: 600 }}>
                  {t.time} <ArrowRight size={12} style={{ verticalAlign: "-1px" }} />
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="book-section">
        <h2>Why these are free</h2>
        <p style={{ color: "var(--faint)", maxWidth: 720 }}>
          Because most small businesses in Ireland are losing work to problems nobody has
          ever pointed out to them — an enquiry form that goes to an inbox no one watches,
          a Google profile with four reviews on it, a website Google can&apos;t read. You
          can fix every one of those yourself with what&apos;s here, and plenty of people
          will. The ones who&apos;d rather have it done properly and kept working tend to
          come and talk to us, and that&apos;s a fair trade.
        </p>
        <p style={{ color: "var(--faint)", maxWidth: 720, fontSize: 13 }}>
          Nothing is stored unless you ask us to. No tool here needs an email address to
          show you its results.
        </p>
        <Link href="/book" className="btn btn-primary" style={{ marginTop: 8 }}>
          Talk to us <ArrowRight size={14} />
        </Link>
      </section>
    </>
  );
}
