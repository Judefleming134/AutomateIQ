import Link from "next/link";
import Script from "next/script";
import type { Metadata } from "next";
import { PhoneCall, ClipboardList, MailCheck, ShieldCheck } from "lucide-react";

export const metadata: Metadata = {
  title: "Live AI Receptionist Demo | AutomateIQ",
  description:
    "Talk to a live AutomateIQ AI receptionist — it answers, captures the job and sends the details instantly.",
  // Demo surface for sales calls — keep it out of search results.
  robots: { index: false, follow: false },
};

/**
 * The branded live-demo page: the voice agent embedded on OUR domain, so a
 * prospect on a Zoom sees automateiq.ie — never the underlying vendor. Used
 * on sales calls: open this page, tap the call bubble, and talk to the
 * receptionist like a customer would. The post-call webhook fires exactly as
 * it does for phone calls, so the job email + portal dashboard light up the
 * same way.
 *
 * The agent is chosen by NEXT_PUBLIC_ELEVENLABS_AGENT_ID (Vercel env). The
 * widget requires the agent's public/shareable toggle to be enabled in its
 * security settings.
 */
export default function DemoPage() {
  const agentId = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID?.trim();

  return (
    <div className="book-page">
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
          <PhoneCall size={14} /> Live demo
        </p>
        <h1>Talk to your AI receptionist</h1>
        <p style={{ maxWidth: "58ch" }}>
          This is a live AutomateIQ receptionist — the same agent that answers
          your phone line. Tap the call button in the corner and talk to it
          exactly like a customer would: give it a name, the problem and where
          you are, then hang up and watch the job land.
        </p>
      </section>

      <section
        style={{
          maxWidth: 900,
          margin: "0 auto",
          padding: "0 20px 60px",
          display: "grid",
          gap: 14,
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
        }}
      >
        {[
          {
            icon: <PhoneCall size={18} />,
            t: "It answers",
            d: "Every call, first ring, day or night — never engaged, never voicemail.",
          },
          {
            icon: <ClipboardList size={18} />,
            t: "It captures the job",
            d: "Name, number, address, the problem and how urgent — read back to confirm.",
          },
          {
            icon: <MailCheck size={18} />,
            t: "It sends it to you",
            d: "The full job card is in your inbox and on your dashboard the moment the caller hangs up.",
          },
          {
            icon: <ShieldCheck size={18} />,
            t: "It stays on the rails",
            d: "Never quotes prices, never invents availability — it takes details and the team confirms.",
          },
        ].map((c) => (
          <div key={c.t} className="panel" style={{ padding: "16px 18px" }}>
            <div style={{ color: "var(--ac2, #3b82f6)", marginBottom: 8 }}>{c.icon}</div>
            <strong style={{ fontSize: 14.5 }}>{c.t}</strong>
            <p style={{ margin: "5px 0 0", fontSize: 13, color: "var(--faint, #9aa3b2)" }}>
              {c.d}
            </p>
          </div>
        ))}
      </section>

      {agentId ? (
        <>
          {/* The voice widget — renders its own call bubble (bottom corner). */}
          <div
            dangerouslySetInnerHTML={{
              __html: `<elevenlabs-convai agent-id="${agentId.replace(/"/g, "")}"></elevenlabs-convai>`,
            }}
          />
          <Script
            src="https://unpkg.com/@elevenlabs/convai-widget-embed"
            strategy="afterInteractive"
            type="text/javascript"
          />
        </>
      ) : (
        <p
          style={{
            textAlign: "center",
            fontSize: 13,
            color: "var(--faint, #9aa3b2)",
            padding: "0 20px 40px",
          }}
        >
          Demo agent not configured yet — set NEXT_PUBLIC_ELEVENLABS_AGENT_ID
          and redeploy.
        </p>
      )}
    </div>
  );
}
