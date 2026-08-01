import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, LogIn, Layers } from "lucide-react";
import { MARKETING_PRODUCTS } from "@/lib/products/marketing";
import { PROOF } from "@/lib/proof";

const SITE = "https://automateiq.ie";

/**
 * Built from the product list, not typed out. The title and description used
 * to name the three products literally, so ReputationIQ shipped onto the page
 * while the <title> and the search snippet still said there were three — the
 * same trap the sitemap test already guards against ("hard-coding them would
 * let a fourth product ship invisible to Google").
 */
const PRODUCT_NAMES = MARKETING_PRODUCTS.map((p) => p.name).join(", ");
const TITLE = `Products — ${PRODUCT_NAMES} | AutomateIQ`;
const DESCRIPTION = `The AutomateIQ product range: ${MARKETING_PRODUCTS.map(
  (p) => `${p.name} ${p.kicker.replace(/^For /i, "for ")}`
).join("; ")}. One login, one set of records, one platform.`;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `${SITE}/products` },
  openGraph: {
    type: "website",
    url: `${SITE}/products`,
    title: TITLE,
    description:
      "One platform, built out by industry. Log in, or request access to any AutomateIQ product.",
    siteName: "AutomateIQ",
    images: [`${SITE}/logo-aiq.png`],
  },
};

/**
 * The index over the product pages.
 *
 * Its job is to be the URL you can say out loud — automateiq.ie/products — and
 * to give every product both of its doors without a click: log in for the
 * people who already pay, request access for the people who might.
 */
export default function ProductsIndexPage() {
  return (
    <div className="book-page prod-page">
      <header className="book-topbar">
        <Link href="/" className="book-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-aiq.png" alt="AutomateIQ" />
        </Link>
        <Link href="/book" className="btn btn-primary btn-sm">
          Book a strategy session
        </Link>
      </header>

      <section className="book-hero">
        <p className="book-kicker">
          <Layers size={14} /> The product range
        </p>
        <h1>One platform, built out by industry</h1>
        <p className="book-hero-sub">
          Start with the core and switch on what your industry needs. Same login,
          same records, same AI — you never end up running two systems that
          don&apos;t talk to each other.
        </p>
        <p className="book-hero-meta">
          {PROOF.jobsProcessedLabel} jobs processed · {PROOF.revenueLiftLabel}{" "}
          revenue {PROOF.revenueLiftWindow} at {PROOF.client}
        </p>
      </section>

      <section className="book-section">
        <div className="prod-index">
          {MARKETING_PRODUCTS.map((p) => (
            <article
              key={p.slug}
              className="panel prod-index-card"
              style={{ ["--prod-accent" as string]: p.accent }}
            >
              <p className="prod-index-kicker">{p.kicker}</p>
              <h2>
                <Link href={`/products/${p.slug}`}>{p.name}</Link>
              </h2>
              <p className="prod-index-sub">{p.sub}</p>
              <ul className="prod-index-list">
                {p.does.slice(0, 3).map((d) => (
                  <li key={d.title}>{d.title}</li>
                ))}
              </ul>
              <div className="prod-index-actions">
                <Link href={p.loginHref} className="btn btn-secondary btn-sm">
                  <LogIn size={14} /> Log in
                </Link>
                <Link
                  href={`/products/${p.slug}#access`}
                  className="btn btn-primary btn-sm"
                >
                  Request access
                </Link>
              </div>
              <Link href={`/products/${p.slug}`} className="prod-index-more">
                What {p.name} does <ArrowRight size={14} />
              </Link>
            </article>
          ))}
        </div>
      </section>

      <section className="book-section">
        <div className="panel prod-proof">
          <p className="book-eyebrow">Not on this list?</p>
          <h2>We build the system that isn&apos;t a product yet</h2>
          <p>
            Most of what AutomateIQ ships started as one company&apos;s problem. If
            your operation needs something bespoke, that&apos;s the other half of
            the business.
          </p>
          <div className="prod-doors" style={{ marginTop: 18 }}>
            <Link href="/systems" className="btn btn-secondary">
              See custom systems
            </Link>
            <Link href="/book" className="btn btn-primary">
              Book a free call <ArrowRight size={15} />
            </Link>
          </div>
        </div>
      </section>

      <footer className="book-footer">
        <Link href="/" className="book-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-aiq.png" alt="AutomateIQ" />
        </Link>
        <p>One platform, built out by industry · automateiq.ie</p>
        <nav className="book-footer-nav">
          <Link href="/">Home</Link>
          <Link href="/systems">Custom systems</Link>
          <Link href="/freetools">Free tools</Link>
          <Link href="/book">Book a call</Link>
        </nav>
      </footer>
    </div>
  );
}
