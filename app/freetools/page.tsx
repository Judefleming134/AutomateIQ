import Link from "next/link";
import type { Metadata } from "next";
import {
  ArrowRight,
  Calculator,
  Check,
  Lock,
  MapPin,
  MessageSquareQuote,
  PhoneMissed,
  Search,
  Timer,
} from "lucide-react";
import { toolCards, liveToolCount, countWord, type ToolCard } from "@/lib/tools/catalog";
import { PROOF } from "@/lib/proof";

/**
 * Rendered per request, not prerendered.
 *
 * Which tools are switched on depends on environment keys, and this page was
 * `○ Static` — so the availability check ran once at build time and froze. The
 * hub would have gone on promising a working Google check for the life of the
 * deployment, which is the exact failure this whole change exists to remove.
 * The page does no I/O beyond reading env, so the dynamic render is cheap.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Free tools for Irish businesses | AutomateIQ",
  description:
    "Free tools, no signup: check your website's SEO, your Google Business Profile, how fast you really reply, what missed calls cost you, reply to reviews, and add instant quotes to your site.",
  alternates: { canonical: "https://automateiq.ie/freetools" },
  openGraph: {
    type: "website",
    url: "https://automateiq.ie/freetools",
    title: "Free tools for Irish businesses",
    description:
      "No signup, no email required, genuinely free. Built for trades and local businesses.",
    siteName: "AutomateIQ",
    images: ["https://automateiq.ie/logo-aiq.png"],
  },
};

const ICONS = {
  search: Search,
  "map-pin": MapPin,
  timer: Timer,
  "phone-missed": PhoneMissed,
  quote: MessageSquareQuote,
  calculator: Calculator,
} as const;

function ToolTile({ tool }: { tool: ToolCard }) {
  const Icon = ICONS[tool.icon];
  const live = tool.status === "live";

  const body = (
    <>
      <span className="ft-tile-top">
        <span className="ft-tile-icon" aria-hidden>
          <Icon size={19} />
        </span>
        <span className="ft-tile-time">{live ? tool.time : "Not switched on"}</span>
      </span>
      <h3>{tool.title}</h3>
      <p className="ft-tile-blurb">{tool.blurb}</p>
      <ul className="ft-tile-gives">
        {tool.gives.map((g) => (
          <li key={g}>
            <Check size={13} aria-hidden /> {g}
          </li>
        ))}
      </ul>
      {live ? (
        <span className="ft-tile-go">
          Run it <ArrowRight size={14} />
        </span>
      ) : (
        <span className="ft-tile-off">
          <Lock size={13} aria-hidden /> {tool.unavailableNote}
        </span>
      )}
    </>
  );

  const style = { ["--ft-accent" as string]: tool.accent };

  // An unavailable tool is NOT a link. It used to be, and the click landed on
  // a dead end — the worst possible first impression from a free tool.
  return live ? (
    <Link href={tool.href} className="ft-tile" style={style}>
      {body}
    </Link>
  ) : (
    <div className="ft-tile ft-tile-muted" style={style}>
      {body}
    </div>
  );
}

export default function ToolsHubPage() {
  const tools = toolCards();
  const live = liveToolCount();

  return (
    <>
      <section className="book-hero ft-hero">
        <p className="book-kicker">Free tools · no signup</p>
        {/* The count is computed. It read "Six things you can check right now"
            while one of the six was switched off. */}
        <h1>
          {countWord(live)} things you can check right now,{" "}
          <span className="ft-hero-ac">for nothing</span>
        </h1>
        <p className="book-hero-sub">
          No signup, no email required, no report held back until you book a call. If they
          show you something worth fixing, fix it yourself — the instructions are right
          there. If you&apos;d rather we did it, you know where we are.
        </p>
        <div className="ft-hero-stats">
          <span>
            <b>€0</b> forever
          </span>
          <span>
            <b>No</b> account
          </span>
          <span>
            <b>Nothing</b> stored
          </span>
          <span>
            <b>{PROOF.jobsProcessedLabel}</b> jobs run on the paid version
          </span>
        </div>
      </section>

      <section className="book-section ft-grid-section">
        <div className="ft-grid">
          {tools.map((t) => (
            <ToolTile key={t.slug} tool={t} />
          ))}
        </div>
      </section>

      <section className="book-section">
        <div className="ft-why">
          <div>
            <p className="book-eyebrow">Why these are free</p>
            <h2>The catch is that there isn&apos;t one.</h2>
            <p>
              Most small businesses in Ireland are losing work to problems nobody has ever
              pointed out to them — an enquiry form going to an inbox no one watches, a
              Google profile with four reviews on it, a website Google can&apos;t read.
            </p>
            <p>
              You can fix every one of those yourself with what&apos;s here, and plenty of
              people will. The ones who&apos;d rather have it done properly and kept
              working tend to come and talk to us. That&apos;s a fair trade.
            </p>
          </div>
          <div className="ft-why-facts">
            <h3>What we do and don&apos;t do</h3>
            <ul>
              <li>
                <Check size={14} aria-hidden /> No tool here needs an email address to show
                you its results
              </li>
              <li>
                <Check size={14} aria-hidden /> Nothing is stored unless you ask us to
              </li>
              <li>
                <Check size={14} aria-hidden /> Full result on screen — nothing held back
                behind a call
              </li>
              <li>
                <Check size={14} aria-hidden /> Same engine our paying customers run on
              </li>
            </ul>
            <div className="ft-why-cta">
              <Link href="/book" className="btn btn-primary">
                Talk to us <ArrowRight size={14} />
              </Link>
              <Link href="/products" className="btn btn-secondary">
                See the products
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
