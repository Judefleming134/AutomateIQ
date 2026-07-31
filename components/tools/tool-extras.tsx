import Link from "next/link";
import {
  ArrowRight,
  Calculator,
  Check,
  MapPin,
  MessageSquareQuote,
  PhoneMissed,
  Search,
  ShieldCheck,
  Timer,
} from "lucide-react";
import { toolCards, getToolCard } from "@/lib/tools/catalog";
import { PROOF } from "@/lib/proof";

/**
 * Shared furniture for the individual free-tool pages.
 *
 * The hub was rebuilt; these pages were left as a bare hero, the tool, and
 * then nothing. Two costs, both paid by the same visitor:
 *
 *   - Before running it, nothing said what they were about to get, so the
 *     honest "no signup, nothing stored" promise was invisible at the exact
 *     moment they were deciding whether to type their website in.
 *   - After running it, the page simply stopped. Someone who just got a
 *     genuinely useful result had no route to the other five tools and no
 *     evidence there was a company behind it.
 *
 * Everything here reads from lib/tools/catalog.ts, so a tool that is switched
 * off can never be linked or advertised from another tool's page.
 */

const ICONS = {
  search: Search,
  "map-pin": MapPin,
  timer: Timer,
  "phone-missed": PhoneMissed,
  quote: MessageSquareQuote,
  calculator: Calculator,
} as const;

/**
 * Sets the tool's accent colour for everything inside it, so each page has its
 * own identity instead of six identical blue ones.
 */
export function ToolAccent({
  slug,
  children,
}: {
  slug: string;
  children: React.ReactNode;
}) {
  const tool = getToolCard(slug);
  return (
    <div
      className="ft-tool"
      style={{ ["--ft-accent" as string]: tool?.accent ?? "var(--ac2)" }}
    >
      {children}
    </div>
  );
}

/**
 * What you get, stated before you use it. Same three lines as the hub card,
 * from the same source, so the promise can't drift between the two surfaces.
 */
export function ToolGives({ slug }: { slug: string }) {
  const tool = getToolCard(slug);
  if (!tool) return null;
  return (
    <div className="ft-gives">
      <ul>
        {tool.gives.map((g) => (
          <li key={g}>
            <Check size={14} aria-hidden /> {g}
          </li>
        ))}
      </ul>
      <p className="ft-gives-trust">
        <ShieldCheck size={13} aria-hidden /> No signup, no email required, nothing
        stored. Takes about {tool.time.replace(/^1 /, "one ")}.
      </p>
    </div>
  );
}

/**
 * The way onward. Every tool page used to end on whitespace — this is the
 * single biggest gap between "a useful free thing" and a front door that
 * actually earns a conversation.
 */
export function ToolNext({ slug }: { slug: string }) {
  // Live tools only, and never the one you're already on.
  const others = toolCards().filter((t) => t.status === "live" && t.slug !== slug);

  return (
    <section className="book-section ft-next">
      <div className="ft-next-head">
        <p className="book-eyebrow">Keep going</p>
        <h2>The other free ones</h2>
      </div>

      {others.length > 0 && (
        <div className="ft-next-grid">
          {others.map((t) => {
            const Icon = ICONS[t.icon];
            return (
              <Link
                key={t.slug}
                href={t.href}
                className="ft-next-card"
                style={{ ["--ft-accent" as string]: t.accent }}
              >
                <span className="ft-next-icon" aria-hidden>
                  <Icon size={17} />
                </span>
                <span className="ft-next-body">
                  <strong>{t.title}</strong>
                  <span>{t.gives[0]}</span>
                </span>
                <span className="ft-next-time">{t.time}</span>
              </Link>
            );
          })}
        </div>
      )}

      <div className="panel ft-next-cta">
        <div>
          <h3>Rather have it done properly, and kept working?</h3>
          <p>
            These check one thing each. The paid version runs the whole job —{" "}
            {PROOF.jobsProcessedLabel} jobs and {PROOF.revenueLiftLabel} revenue{" "}
            {PROOF.revenueLiftWindow} for {PROOF.client}. Fifteen minutes, no pitch
            deck, and you keep the plan either way.
          </p>
        </div>
        <div className="ft-next-cta-actions">
          <Link href="/book" className="btn btn-primary">
            Book a free call <ArrowRight size={14} />
          </Link>
          <Link href="/products" className="btn btn-secondary">
            See the products
          </Link>
        </div>
      </div>
    </section>
  );
}
