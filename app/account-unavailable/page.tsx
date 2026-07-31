import Link from "next/link";
import type { Metadata } from "next";
import { ShieldAlert, Mail } from "lucide-react";

export const metadata: Metadata = {
  title: "Account unavailable — AutomateIQ",
  robots: { index: false, follow: false },
};

/**
 * Shown when a signed-in user's business isn't an active tenant — suspended,
 * soft-deleted, or otherwise not readable through their own RLS scope.
 *
 * Before this page existed they landed on the portal itself: it rendered in
 * full, the business name fell back to the placeholder "Your business", and
 * every panel was empty because RLS hid all their data. Someone suspended for
 * an unpaid invoice saw what looked like their account being wiped, with
 * nothing on screen to explain it.
 *
 * It lives OUTSIDE the /portal tree deliberately — inside it, the portal layout
 * would guard the page that exists to explain why the guard fired, and the
 * redirect would loop.
 *
 * The copy does not distinguish suspended from deleted from missing. All three
 * resolve the same way — a person at AutomateIQ looking at the account — and
 * guessing at the reason on screen would be worse than saying plainly that we
 * need to sort it out together.
 */
export default function AccountUnavailablePage() {
  return (
    <div className="book-page sv-page">
      <section className="book-hero">
        <p className="book-kicker">
          <ShieldAlert size={14} /> Account unavailable
        </p>
        <h1>Your account isn&apos;t active right now</h1>
        <p className="book-hero-sub">
          You&apos;re signed in, but this account isn&apos;t currently active, so
          there&apos;s nothing we can show you here. Nothing has been lost —
          it&apos;s a status on the account, not your data.
        </p>
      </section>

      <section className="book-section" style={{ borderTop: "none", paddingTop: 0 }}>
        <div className="panel panel-block">
          <p className="aseo-block-label">What to do</p>
          <p style={{ fontSize: 14, margin: "0 0 14px", lineHeight: 1.6 }}>
            Get in touch and we&apos;ll sort it out. If it&apos;s an unpaid invoice
            it&apos;s usually reactivated the same day.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <a href="mailto:hello@automateiq.ie" className="btn btn-primary">
              <Mail size={13} /> hello@automateiq.ie
            </a>
            <Link href="/" className="btn btn-secondary">
              Back to automateiq.ie
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
