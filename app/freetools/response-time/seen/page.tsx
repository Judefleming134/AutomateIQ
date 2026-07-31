import Link from "next/link";
import { ToolLeadForm } from "@/components/tools/tool-lead-form";
import type { Metadata } from "next";
import { AlertTriangle, ArrowRight, Timer } from "lucide-react";
import { readToken } from "@/lib/tools/token";

export const metadata: Metadata = {
  title: "Your response time | AutomateIQ",
  robots: { index: false, follow: false },
};

/** A link older than this is stale — the result would be meaningless. */
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

function human(ms: number): { big: string; unit: string } {
  const mins = ms / 60000;
  if (mins < 1) return { big: String(Math.max(1, Math.round(ms / 1000))), unit: "seconds" };
  if (mins < 90) return { big: String(Math.round(mins)), unit: Math.round(mins) === 1 ? "minute" : "minutes" };
  const hours = mins / 60;
  if (hours < 48) return { big: String(Math.round(hours)), unit: Math.round(hours) === 1 ? "hour" : "hours" };
  return { big: String(Math.round(hours / 24)), unit: "days" };
}

/**
 * Grades the gap the way a customer would experience it, not the way an
 * agency would like to report it. Under five minutes genuinely is excellent
 * and is told so plainly — a tool that finds a problem no matter what the
 * number says is a sales pitch, not a test.
 */
function verdict(ms: number): { tone: string; title: string; body: string } {
  const mins = ms / 60000;
  if (mins <= 5) {
    return {
      tone: "is-good",
      title: "That's genuinely excellent",
      body: "You're inside the five-minute window where almost every enquiry is still winnable. Very few small businesses manage this. The only question worth asking is whether it holds at 8pm on a Saturday, and when you're on a job.",
    };
  }
  if (mins <= 60) {
    return {
      tone: "is-warn",
      title: "Respectable — but the fast ones already replied",
      body: "Within the hour is better than most. The catch is that people enquiring about work usually contact two or three businesses at once, and a good share have an answer from someone else inside the first few minutes. You're arriving to a conversation that's already started.",
    };
  }
  if (mins <= 60 * 24) {
    return {
      tone: "",
      title: "This is where the work is going elsewhere",
      body: "By the time an enquiry is this old, most people have already spoken to someone else — often booked with them. It isn't a reflection on you; it's what happens when the person answering enquiries is also the person doing the job.",
    };
  }
  return {
    tone: "",
    title: "A real customer would be long gone",
    body: "An enquiry sitting this long is a lost job in almost every case, and it's the kind of thing that quietly turns into a bad review about not getting a call back. Worth knowing this is what's happening rather than assuming it isn't.",
  };
}

export default async function SeenPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const { t } = await searchParams;
  const payload = t ? readToken<{ t: number; h: string }>(t, MAX_AGE_MS) : null;

  if (!payload) {
    return (
      <section className="book-hero">
        <h1>That link has expired</h1>
        <p className="book-hero-sub">
          Response-time links are only good for a couple of weeks — after that the number
          wouldn&apos;t mean anything. Run the test again whenever you like.
        </p>
        <Link href="/freetools/response-time" className="btn btn-primary">
          Run the test again <ArrowRight size={14} />
        </Link>
      </section>
    );
  }

  const elapsed = Math.max(0, Date.now() - payload.t);
  const { big, unit } = human(elapsed);
  const v = verdict(elapsed);

  return (
    <>
      <section className="book-hero">
        <p className="book-kicker">
          <Timer size={14} /> Your result — {payload.h}
        </p>
        <h1>
          {big} {unit}
        </h1>
        <p className="book-hero-sub">
          That&apos;s how long a customer&apos;s enquiry sat in your inbox before anyone
          looked at it. Not how long until you replied — how long until you even knew it
          was there.
        </p>
      </section>

      <section className="book-section" style={{ borderTop: "none", paddingTop: 0 }}>
        <div className={`aseo-hero ${v.tone}`}>
          <h3>{v.title}</h3>
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.65 }}>{v.body}</p>

          <div className="aseo-block">
            <p className="aseo-block-label">One caveat, in fairness</p>
            <p style={{ fontSize: 13.5, color: "var(--faint)" }}>
              This is a single measurement on a single day, and if the email landed in
              spam it says more about your filters than your habits. Run it again next
              week and see whether the number holds — that&apos;s the one that counts.
            </p>
          </div>
        </div>

        <div
          className="panel panel-block"
          style={{ marginTop: 20, borderLeft: "3px solid var(--ac1, #8b5cf6)" }}
        >
          <strong>What this number would be with an agent answering</strong>
          <p style={{ fontSize: 13.5, color: "var(--faint)", margin: "6px 0 10px" }}>
            Under a minute, at 3am, on a Sunday, while you&apos;re up a ladder. Every
            enquiry gets a real answer, the details you need get asked for, and it lands
            in your phone already qualified. That&apos;s the whole product.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link href="/book" className="btn btn-primary btn-sm">
              See it working <ArrowRight size={13} />
            </Link>
            <Link href="/freetools/missed-calls" className="btn btn-secondary btn-sm">
              What that gap costs in euro
            </Link>
          </div>
        </div>

        <ToolLeadForm
          tool="response-time"
          subject={payload.h}
          headline={`${big} ${unit} to notice an enquiry`}
          topFinding={v.title}
          title="Want this result and the fix sent over?"
          blurb="Leave your email and we'll send your number with what we'd change to close the gap. One reply from a person, no list."
        />

        <p style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 12 }}>
          <AlertTriangle size={11} style={{ verticalAlign: "-1px" }} /> Nothing about this
          test was stored — the timing lives in the link itself, which is why it expires.
        </p>
      </section>
    </>
  );
}
