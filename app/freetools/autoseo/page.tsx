import Link from "next/link";
import { ToolAccent, ToolGives, ToolNext } from "@/components/tools/tool-extras";
import type { Metadata } from "next";
import { Search, Gauge, MapPin, Wrench } from "lucide-react";
import { Auditor } from "./auditor";

export const metadata: Metadata = {
  title: "Free Website SEO Audit | AutomateIQ",
  description:
    "Check any business website in 20 seconds — free, no signup. See exactly why you're not showing up on Google, in plain English, with the code to fix each problem ready to copy and paste.",
  alternates: { canonical: "https://automateiq.ie/freetools/autoseo" },
  openGraph: {
    type: "website",
    url: "https://automateiq.ie/freetools/autoseo",
    title: "Free Website SEO Audit | AutomateIQ",
    description:
      "Why isn't your business showing up on Google? Free 20-second check, plain-English answers, and the exact fixes.",
    siteName: "AutomateIQ",
    images: ["https://automateiq.ie/logo-aiq.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Free Website SEO Audit | AutomateIQ",
    description: "Free 20-second check of any business website — and the exact fixes.",
  },
};

export default function AutoSeoPage() {
  return (
    <ToolAccent slug="autoseo">
      <section className="book-hero">
        <p className="book-kicker">
          <Search size={14} /> AutoSEO — free website check
        </p>
        <h1>Why isn&apos;t your business showing up on Google?</h1>
        <p className="book-hero-sub">
          Put your website in below. In about twenty seconds you&apos;ll get a straight
          answer — what&apos;s missing, what it&apos;s costing you, and the exact code to
          fix it. No signup, no report held to ransom, no jargon. Free, and staying free.
        </p>
      </section>

      <ToolGives slug="autoseo" />

      <section className="book-section" style={{ borderTop: "none", paddingTop: 0 }}>
        <Auditor />
      </section>

      <section className="book-section">
        <div className="sys-pillars">
          <div className="sys-pillar">
            <span className="sys-pillar-icon">
              <MapPin size={18} />
            </span>
            <h3>Built for local Irish businesses</h3>
            <p>
              Most SEO tools are built for online shops. This one checks the things that
              actually decide whether a plumber in Blanchardstown or a salon in Galway
              turns up in a &ldquo;near me&rdquo; search — your business details in a
              format Google trusts, your name, address and phone matching your Google
              Business Profile, and your Eircode where it can be read.
            </p>
          </div>
          <div className="sys-pillar">
            <span className="sys-pillar-icon">
              <Gauge size={18} />
            </span>
            <h3>Plain English, no scores you can&apos;t act on</h3>
            <p>
              Every finding says what&apos;s on your site right now, why it matters to
              your phone ringing, and what to do about it. If a check passes, it says so
              and moves on — there&apos;s no padding the list to make things look
              worse than they are.
            </p>
          </div>
          <div className="sys-pillar">
            <span className="sys-pillar-icon">
              <Wrench size={18} />
            </span>
            <h3>The fix, not just the problem</h3>
            <p>
              Where there&apos;s a concrete fix, you get the actual code — your business
              schema block, meta tags, robots.txt — pre-filled with the details we could
              read off your site. Copy it, paste it, or forward it to whoever built the
              site.
            </p>
          </div>
        </div>
      </section>

      <section className="book-section">
        <h2>What this checks</h2>
        <p style={{ color: "var(--faint)", maxWidth: 720 }}>
          Your page title and search description, headings, whether your content is
          readable by Google at all, mobile setup, secure connection, business schema,
          your name/address/phone, tap-to-call, image descriptions, amount of content,
          internal links, robots.txt, sitemap, link previews for WhatsApp and Facebook,
          favicon and server response speed. Nineteen checks, weighted by how much each
          one actually moves the needle.
        </p>
        <p style={{ color: "var(--faint)", maxWidth: 720, fontSize: 13 }}>
          It reads your website exactly the way a search engine does — the public page,
          your robots.txt and your sitemap. Nothing is changed, nothing is stored unless
          you ask us to email it to you, and we don&apos;t need any access to your site.
        </p>
      </section>
      <ToolNext slug="autoseo" />
    </ToolAccent>
  );
}
