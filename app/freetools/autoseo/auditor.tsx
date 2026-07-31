"use client";

import { useState } from "react";
import { ToolLeadForm } from "@/components/tools/tool-lead-form";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Copy,
  Loader2,
  Search,
  TriangleAlert,
  X,
} from "lucide-react";
import type { SeoAudit, SeoCheck } from "@/lib/seo/audit";

const STATUS_ICON = {
  pass: { icon: Check, colour: "var(--green, #34d399)" },
  warn: { icon: TriangleAlert, colour: "var(--orange, #fb923c)" },
  fail: { icon: X, colour: "var(--red, #f87171)" },
} as const;

function scoreColour(score: number) {
  if (score >= 75) return "var(--green, #34d399)";
  if (score >= 50) return "var(--orange, #fb923c)";
  return "var(--red, #f87171)";
}

/** The dial. A number in a ring reads instantly; a number in a row doesn't. */
function ScoreDial({ score }: { score: number }) {
  const R = 44;
  const C = 2 * Math.PI * R;
  const filled = Math.max(0, Math.min(100, score)) / 100;
  return (
    <div className="aseo-dial">
      <svg width="104" height="104" viewBox="0 0 104 104" aria-hidden>
        <circle className="aseo-dial-track" cx="52" cy="52" r={R} fill="none" strokeWidth="8" />
        <circle
          className="aseo-dial-fill"
          cx="52"
          cy="52"
          r={R}
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          stroke={scoreColour(score)}
          strokeDasharray={C}
          strokeDashoffset={C * (1 - filled)}
        />
      </svg>
      <div className="aseo-dial-num">
        <b style={{ color: scoreColour(score) }}>{score}</b>
        <span>OUT OF 100</span>
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-secondary btn-sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          // Clipboard blocked — the code is on screen and selectable anyway.
          setCopied(false);
        }
      }}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy the fix"}
    </button>
  );
}

/**
 * The single finding that gets the whole screen: what's wrong, what it costs,
 * and the code. Everything else on the page is deliberately quieter than this.
 */
function HeroFinding({ check, rank }: { check: SeoCheck; rank: number }) {
  const tone =
    check.status === "fail" ? "" : check.status === "warn" ? " is-warn" : " is-good";
  return (
    <div className={`aseo-hero${tone}`}>
      <h3>
        {rank}. {check.label}
      </h3>

      <div className="aseo-now">
        <strong>Right now: </strong>
        {check.found}
      </div>

      <div className="aseo-block">
        <p className="aseo-block-label">Why it costs you</p>
        <p>{check.why}</p>
      </div>

      <div className="aseo-block">
        <p className="aseo-block-label">The fix</p>
        <p>{check.fix}</p>
      </div>

      {check.snippet && (
        <div className="aseo-block">
          <div className="aseo-code-head">
            <p className="aseo-block-label" style={{ margin: 0 }}>
              Paste this in — replace anything in [square brackets]
            </p>
            <CopyButton text={check.snippet} />
          </div>
          <pre className="aseo-code">
            <code>{check.snippet}</code>
          </pre>
        </div>
      )}
    </div>
  );
}

export function Auditor() {
  const [url, setUrl] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audit, setAudit] = useState<SeoAudit | null>(null);
  /** How many findings are shown at full size. Starts at one, on purpose. */
  const [shown, setShown] = useState(1);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (running) return;
    const target = url.trim();
    if (!target) {
      setError("Put your website address in first.");
      return;
    }
    setRunning(true);
    setError(null);
    setAudit(null);
    setShown(1);
    try {
      const res = await fetch("/api/autoseo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: target }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "Couldn't check that site. Try again in a moment.");
      } else {
        setAudit(data as SeoAudit);
      }
    } catch {
      setError("Couldn't reach the checker — check your connection and try again.");
    } finally {
      setRunning(false);
    }
  }

  // The engine returns checks already ranked worst-first, so "the one thing"
  // is simply the first one that isn't already passing.
  const problems = audit?.checks.filter((c) => c.status !== "pass") ?? [];
  const good = audit?.checks.filter((c) => c.status === "pass") ?? [];
  const heroes = problems.slice(0, shown);
  const upNext = problems.slice(shown, shown + 2);
  const remaining = Math.max(0, problems.length - shown - upNext.length);

  return (
    <div>
      <form
        onSubmit={run}
        style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}
      >
        <input
          type="text"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="yourbusiness.ie"
          aria-label="Your website address"
          disabled={running}
          style={{ flex: "1 1 280px", minWidth: 0 }}
        />
        <button type="submit" className="btn btn-primary" disabled={running}>
          {running ? (
            <>
              <Loader2 size={15} className="book-spin" /> Checking…
            </>
          ) : (
            <>
              <Search size={15} /> Check my website
            </>
          )}
        </button>
      </form>

      {running && (
        <p style={{ fontSize: 13, color: "var(--faint)" }}>
          Reading your homepage, robots.txt and sitemap the way Google would — up to
          twenty seconds.
        </p>
      )}

      {error && !running && (
        <div
          className="panel panel-block"
          style={{ borderLeft: "3px solid var(--red, #f87171)" }}
        >
          <strong style={{ color: "var(--red, #f87171)" }}>
            <AlertTriangle size={15} style={{ verticalAlign: "-2px" }} /> {error}
          </strong>
        </div>
      )}

      {audit && !running && (
        <div>
          {/* Score + the one-line verdict. Nothing else competes up here. */}
          <div className="aseo-head">
            <ScoreDial score={audit.score} />
            <div className="aseo-verdict">
              <p className="aseo-host">{audit.host}</p>
              <h2>{audit.verdict}</h2>
              <p>
                {problems.length} thing{problems.length === 1 ? "" : "s"} to sort ·{" "}
                {good.length} already right
              </p>
            </div>
          </div>

          {audit.blockers.length > 0 && (
            <div
              className="panel panel-block"
              style={{ borderLeft: "3px solid var(--red, #f87171)", marginTop: 12 }}
            >
              <strong style={{ color: "var(--red, #f87171)" }}>
                <AlertTriangle size={15} style={{ verticalAlign: "-2px" }} /> Your score
                is capped until this is fixed
              </strong>
              <p style={{ fontSize: 13.5, margin: "6px 0 0" }}>
                Google isn&apos;t reading your pages at all, so none of the other
                improvements can help yet. Sort the one below first, then run this check
                again.
              </p>
            </div>
          )}

          {problems.length === 0 ? (
            <div className="aseo-step-label" style={{ color: "var(--green, #34d399)" }}>
              <Check size={14} /> Every check passed — genuinely nothing to fix
            </div>
          ) : (
            <>
              {/* "Your biggest bottleneck" is the right words for a broken
                  site and the wrong ones for a site scoring 95 with a single
                  warning left — the label follows the severity. */}
              <p className="aseo-step-label">
                <AlertTriangle size={13} />{" "}
                {problems.some((c) => c.status === "fail" && c.impact === "high")
                  ? "Start here — your biggest bottleneck"
                  : "Your best remaining win"}
              </p>
              {heroes.map((c, i) => (
                <div key={c.id} style={{ marginBottom: i === heroes.length - 1 ? 0 : 14 }}>
                  <HeroFinding check={c} rank={i + 1} />
                </div>
              ))}

              {/* Named, not explained — one tap turns the next one into a full
                  card. Reading nineteen findings at once is how a free report
                  gets closed without a single fix being made. */}
              {upNext.length > 0 && (
                <>
                  <p className="aseo-step-label">Then these</p>
                  <div className="aseo-next">
                    {upNext.map((c, i) => (
                      <div className="aseo-next-card" key={c.id}>
                        <strong>
                          {shown + i + 1}. {c.label}
                        </strong>
                        <span>{c.found}</span>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    style={{ marginTop: 12 }}
                    onClick={() => setShown((n) => n + 1)}
                  >
                    Show me how to fix #{shown + 1} <ArrowRight size={13} />
                  </button>
                </>
              )}

              {/* The full list stays available — just not in the way. */}
              <details className="aseo-rest">
                <summary>
                  See all {audit.checks.length} checks
                  {remaining > 0 ? ` (${remaining} more to sort, ` : " ("}
                  {good.length} already right)
                </summary>
                <div style={{ marginTop: 8 }}>
                  {audit.checks.map((c) => {
                    const meta = STATUS_ICON[c.status];
                    const Icon = meta.icon;
                    return (
                      <div className="aseo-row" key={c.id}>
                        <span style={{ color: meta.colour, marginTop: 2 }} aria-hidden>
                          <Icon size={15} />
                        </span>
                        <div className="aseo-row-txt">
                          <strong>{c.label}</strong>
                          <span>{c.found}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </details>
            </>
          )}

          {/* The one place this tool asks for an email — under a finished
              report, never in front of one. See ToolLeadForm. */}
          <ToolLeadForm
            tool="autoseo"
            subject={audit.host}
            headline={`${audit.score}/100 (${audit.grade})`}
            topFinding={audit.checks[0]?.label ?? null}
          />

          <div
            className="panel panel-block"
            style={{ marginTop: 20, borderLeft: "3px solid var(--ac1, #8b5cf6)" }}
          >
            <strong>Want it done rather than described?</strong>
            <p style={{ fontSize: 13.5, color: "var(--faint)", margin: "6px 0 10px" }}>
              Everything here is yours to use free. If you&apos;d rather not touch it,
              we do it for you — fixes applied, Google Business Profile sorted, and the
              site checked again after so you can see it worked.
            </p>
            <Link href="/book" className="btn btn-primary btn-sm">
              Talk to us about fixing it <ArrowRight size={13} />
            </Link>
          </div>

          <p style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 10 }}>
            Checked {new Date(audit.fetchedAt).toLocaleString("en-IE")} · nothing on your
            site was changed.
          </p>
        </div>
      )}
    </div>
  );
}
