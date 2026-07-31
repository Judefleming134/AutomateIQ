import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowRight, LogIn, Check } from "lucide-react";
import { MARKETING_PRODUCTS, getMarketingProduct } from "@/lib/products/marketing";
import { PROOF } from "@/lib/proof";
import { RequestAccessForm } from "../request-access-form";

const SITE = "https://automateiq.ie";

/**
 * A public page per vertical product.
 *
 * Statically generated for the three known slugs — nothing here depends on a
 * request, so it renders at build time and a first-time visitor gets HTML with
 * no round trip.
 */
export function generateStaticParams() {
  return MARKETING_PRODUCTS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const product = getMarketingProduct(slug);
  if (!product) return {};

  const title = `${product.name} — ${product.headline} | AutomateIQ`;
  const url = `${SITE}/products/${product.slug}`;
  return {
    title,
    description: product.sub,
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      url,
      title,
      description: product.sub,
      siteName: "AutomateIQ",
      images: [`${SITE}/logo-aiq.png`],
    },
    twitter: { card: "summary_large_image", title, description: product.sub },
  };
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const product = getMarketingProduct(slug);
  if (!product) notFound();

  const others = MARKETING_PRODUCTS.filter((p) => p.slug !== product.slug);

  return (
    <div
      className="book-page prod-page"
      style={{ ["--prod-accent" as string]: product.accent }}
    >
      <header className="book-topbar">
        <Link href="/" className="book-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-aiq.png" alt="AutomateIQ" />
        </Link>
        {/* Both doors, in the top bar as well as the hero. Someone who already
            has an account should never have to scroll to find the way in. */}
        <div className="prod-topbar-actions">
          <Link href={product.loginHref} className="btn btn-secondary btn-sm">
            <LogIn size={14} /> Log in
          </Link>
          <a href="#access" className="btn btn-primary btn-sm">
            Request access
          </a>
        </div>
      </header>

      <section className="book-hero">
        <p className="book-kicker prod-kicker">{product.kicker}</p>
        <h1>
          <span className="prod-name">{product.name}</span> — {product.headline}
        </h1>
        <p className="book-hero-sub">{product.sub}</p>
        <div className="prod-doors">
          <Link href={product.loginHref} className="btn btn-secondary">
            <LogIn size={15} /> Log in
          </Link>
          <a href="#access" className="btn btn-primary">
            Request access <ArrowRight size={15} />
          </a>
        </div>
        <p className="book-hero-meta" style={{ marginTop: 14 }}>
          Already a customer? Log in. New here? Request access and a real person
          gets back to you.
        </p>
      </section>

      <section className="book-section">
        <div className="book-section-head">
          <p className="book-eyebrow">Who it&apos;s for</p>
          <h2>{product.who}</h2>
        </div>
      </section>

      <section className="book-section" id="what">
        <div className="book-section-head">
          <p className="book-eyebrow">What it does</p>
          <h2>The parts that do the work</h2>
        </div>
        <div className="prod-does">
          {product.does.map((d) => (
            <div className="prod-does-card" key={d.title}>
              <span className="prod-does-tick">
                <Check size={15} />
              </span>
              <h3>{d.title}</h3>
              <p>{d.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Proof, from lib/proof.ts — the same figures the homepage and every
          outreach email quote, so they cannot disagree. */}
      <section className="book-section">
        <div className="panel prod-proof">
          <p className="book-eyebrow">Proof, not promises</p>
          <h2>
            {PROOF.jobsProcessedLabel} jobs processed. {PROOF.revenueLiftLabel}{" "}
            revenue {PROOF.revenueLiftWindow}.
          </h2>
          <p>
            Not a projection — the measured result at{" "}
            <a href={PROOF.clientUrl} target="_blank" rel="noopener">
              {PROOF.client}
            </a>
            , where we built the customer portal, the installer portal and the
            admin control room over both, all on one database.
          </p>
        </div>
      </section>

      {/* The request-access door, full width, at the end of the argument. */}
      <section className="book-section" id="access">
        <div className="panel prod-access">
          <p className="book-eyebrow">Request access</p>
          <h2>Get set up on {product.name}</h2>
          <p>
            Tell us where to reach you and we&apos;ll get you onboarded. No card, no
            demo bot — a real conversation about whether it fits how you work.
          </p>
          <RequestAccessForm
            source={product.leadSource}
            productName={product.name}
            accent={product.accent}
          />
          <p className="prod-access-alt">
            Already have an account?{" "}
            <Link href={product.loginHref}>Log in to {product.name}</Link>. Prefer
            to talk first? <Link href="/book">Book a free 15-minute call</Link>.
          </p>
        </div>
      </section>

      <section className="book-section">
        <div className="book-section-head">
          <p className="book-eyebrow">The rest of the platform</p>
          <h2>Same login, same records</h2>
          <p className="book-lead" style={{ marginTop: 10 }}>
            Every product runs on the AutomateIQ core, so switching one on
            doesn&apos;t mean running a second system that doesn&apos;t talk to the
            first.
          </p>
        </div>
        <div className="prod-others">
          {others.map((o) => (
            <Link
              key={o.slug}
              href={`/products/${o.slug}`}
              className="prod-other-card"
              style={{ ["--prod-accent" as string]: o.accent }}
            >
              <h3>{o.name}</h3>
              <p>{o.sub}</p>
              <span className="prod-other-go">
                See {o.name} <ArrowRight size={14} />
              </span>
            </Link>
          ))}
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
          <Link href="/products">All products</Link>
          <Link href="/systems">Custom systems</Link>
          <Link href="/book">Book a call</Link>
        </nav>
      </footer>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            name: product.name,
            applicationCategory: "BusinessApplication",
            operatingSystem: "Web",
            url: `${SITE}/products/${product.slug}`,
            description: product.sub,
            publisher: {
              "@type": "Organization",
              name: "AutomateIQ",
              url: SITE,
            },
          }),
        }}
      />
    </div>
  );
}
