import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, LogIn, Layers } from "lucide-react";
import { MARKETING_PRODUCTS, marketingGroups } from "@/lib/products/marketing";
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

      {/* THE WHOLE RANGE, ON ONE SCREEN.
          Eleven cards is roughly four thousand pixels of scroll on a phone,
          with no way to tell what is further down or how much further down it
          is — someone who came here for QuoteIQ had to swipe past ten other
          products to find out whether it was even on the page.
          These chips are the contents page: all eleven visible at once in four
          rows (159px measured at 390px wide), each a direct tap to its own
          page. Carrying the accent makes the list read as a range, not a wall.
          Deliberately not sticky — .book-topbar already is, and it wraps to two
          rows at 620px, so a second pinned bar would take a third of the
          screen and no fixed `top` offset would be right at both widths. */}
      <nav className="prod-jump" aria-label="Jump to a product">
        {MARKETING_PRODUCTS.map((p) => (
          <Link
            key={p.slug}
            href={`/products/${p.slug}`}
            className="prod-jump-chip"
            style={{ ["--prod-accent" as string]: p.accent }}
          >
            <span className="prod-jump-dot" aria-hidden="true" />
            {p.name}
          </Link>
        ))}
      </nav>

      {/* GROUPED, not one flat list of seven.
          The hero above already promises "start with the core and switch on
          what your industry needs" — rendering all seven undifferentiated
          contradicted the sentence directly above them, and left a lone card
          stranded on a third row of a 3-column grid. That orphan is the exact
          failure the free-tools hub had to fix once already.
          Four industry products lay out 2x2, the core three in one row. */}
      {marketingGroups().map(({ group, products }) => (
        <section className="book-section" key={group.key}>
          {/* The count answers "is it worth scrolling this section?" — on a
              phone the heading is off screen after the first card and there is
              otherwise nothing saying whether two more follow or six. */}
          <div className="prod-group-head">
            <h2>
              {group.label}{" "}
              <span className="prod-group-count">{products.length}</span>
            </h2>
            <p>{group.blurb}</p>
          </div>
          <div className={`prod-index prod-index--${group.key}`}>
            {products.map((p) => (
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
      ))}

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
