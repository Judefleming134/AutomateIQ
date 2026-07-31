import Link from "next/link";

/**
 * Every free-tool page renders per request, set once here rather than six
 * times.
 *
 * These pages read which tools are switched on (lib/tools/catalog.ts) to show
 * the "keep going" strip, and a statically prerendered page freezes that
 * answer at build time. It already bit twice: the hub kept advertising a dead
 * Google checker, and then the cross-links did the same thing more quietly —
 * the review writer appeared on one tool page and was missing from four
 * others, purely because those four were prerendered before the key existed.
 *
 * Declaring it on the segment means a seventh tool inherits it instead of
 * having to remember. The pages do no I/O beyond reading env.
 */
export const dynamic = "force-dynamic";

/**
 * Shared chrome for the free tools. Every one of them is a front door for
 * someone who has never heard of AutomateIQ, so each page carries the same
 * header, the same way back to the others, and the same one-line promise.
 *
 * The footer is new. Every tool page previously ended on whitespace with no
 * way onward — a visitor who got a useful result had nowhere to go and no
 * evidence there was a company behind it.
 */
export default function ToolsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="book-page sv-page">
      <header className="book-topbar">
        <Link href="/" className="book-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-aiq.png" alt="AutomateIQ" />
        </Link>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Link href="/freetools" className="btn btn-ghost btn-sm">
            All free tools
          </Link>
          <Link href="/book" className="btn btn-primary btn-sm">
            Book a strategy session
          </Link>
        </div>
      </header>

      {children}

      <footer className="book-footer">
        <Link href="/" className="book-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-aiq.png" alt="AutomateIQ" />
        </Link>
        <p>
          Free because the ones who&apos;d rather have it done properly come and talk to us
          · automateiq.ie
        </p>
        <nav className="book-footer-nav">
          <Link href="/">Home</Link>
          <Link href="/products">Products</Link>
          <Link href="/systems">Custom systems</Link>
          <Link href="/freetools">All free tools</Link>
          <Link href="/book">Book a call</Link>
          <Link href="/login">Log in</Link>
        </nav>
      </footer>
    </div>
  );
}
