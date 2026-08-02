"use client";

import { useState } from "react";
import Link from "next/link";
import { ToolLeadForm } from "@/components/tools/tool-lead-form";
import { AlertTriangle, ArrowRight, Check, Loader2, MapPin, Star, TriangleAlert, X } from "lucide-react";
import {
  SELF_QUESTIONS,
  SELF_LOOKUP_HINT,
  PROFILE_QUESTIONS,
  isComplete,
  scoreSelfCheck,
  type SelfAnswers,
  type SelfField,
} from "@/lib/tools/gbp-self";
import type { GbpResult } from "@/lib/tools/gbp-report";

type Result = GbpResult;

const ICON = {
  pass: { icon: Check, colour: "var(--green, #34d399)" },
  warn: { icon: TriangleAlert, colour: "var(--orange, #fb923c)" },
  fail: { icon: X, colour: "var(--red, #f87171)" },
} as const;

const colour = (s: number) =>
  s >= 75 ? "var(--green, #34d399)" : s >= 50 ? "var(--orange, #fb923c)" : "var(--red, #f87171)";

export function GbpChecker({ configured }: { configured: boolean }) {
  const [query, setQuery] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  // The free path. Nothing here touches the network, so there is no loading
  // state and no way for it to fail — the report is computed on the click.
  const [answers, setAnswers] = useState<SelfAnswers>({});

  const pick = (id: SelfField, value: string) =>
    setAnswers((a) => ({ ...a, [id]: value }));

  function runSelfCheck(e: React.FormEvent) {
    e.preventDefault();
    if (!isComplete(answers)) return;
    setError(null);
    setResult(scoreSelfCheck(answers));
  }

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (running || !query.trim()) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/tools/gbp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: query.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) setError(data?.error ?? "Couldn't check that profile.");
      else setResult(data as Result);
    } catch {
      setError("Couldn't reach the checker — check your connection.");
    } finally {
      setRunning(false);
    }
  }

  const problems = result?.findings.filter((f) => f.status !== "pass") ?? [];
  const top = problems[0];
  // Once a profile is said not to exist, the seven follow-ups are about a
  // thing that isn't there — asking them would be daft, and the report for
  // that case is written separately.
  const asking = answers.hasProfile === "yes" ? SELF_QUESTIONS : SELF_QUESTIONS.slice(0, 1);
  const ready = isComplete(answers);

  return (
    <div>
      {configured ? (
        <form onSubmit={run} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Murphy Plumbing, Blanchardstown"
            aria-label="Your business name and town"
            disabled={running}
            maxLength={160}
            style={{ flex: "1 1 300px", minWidth: 0 }}
          />
          <button type="submit" className="btn btn-primary" disabled={running}>
            {running ? (
              <>
                <Loader2 size={15} className="book-spin" /> Looking you up…
              </>
            ) : (
              <>
                <MapPin size={15} /> Check my profile
              </>
            )}
          </button>
        </form>
      ) : (
        /* The free path (J1). This used to be a dead end reading "Not switched
           on yet" — a front door with a locked door behind it, waiting on a
           card being put on a Google Cloud account.

           The Places API was only ever doing data entry: it read seven facts
           off a public profile that the owner can see on their phone in a
           minute. The analysis — what each one costs you, what to do, in what
           order — was ours all along and is now shared with the paid path, so
           this produces the identical report. See lib/tools/gbp-self.ts. */
        <form onSubmit={runSelfCheck} style={{ marginBottom: 16 }}>
          <div className="panel panel-block" style={{ marginBottom: 14 }}>
            <strong>
              <MapPin size={14} style={{ verticalAlign: "-2px" }} /> Have your profile open
              while you answer
            </strong>
            <p style={{ fontSize: 13.5, color: "var(--faint)", margin: "6px 0 0" }}>
              {SELF_LOOKUP_HINT}
            </p>
          </div>

          <label style={{ display: "block", marginBottom: 16 }}>
            <span style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>
              What&apos;s the business called?
            </span>
            <input
              value={answers.name ?? ""}
              onChange={(e) => setAnswers((a) => ({ ...a, name: e.target.value }))}
              placeholder="Murphy Plumbing"
              aria-label="Your business name"
              maxLength={120}
              style={{ width: "100%", maxWidth: 420 }}
            />
          </label>

          {asking.map((q) => (
            <fieldset
              key={q.id}
              style={{ border: 0, padding: 0, margin: "0 0 18px" }}
            >
              <legend style={{ fontWeight: 600, marginBottom: 4, padding: 0 }}>
                {q.question}
              </legend>
              {q.hint && (
                <p style={{ fontSize: 12.5, color: "var(--faint)", margin: "0 0 8px" }}>
                  {q.hint}
                </p>
              )}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {q.options.map((o) => {
                  const on = answers[q.id] === o.value;
                  return (
                    <button
                      type="button"
                      key={o.value}
                      onClick={() => pick(q.id, o.value)}
                      className={`btn btn-sm ${on ? "btn-primary" : "btn-secondary"}`}
                      aria-pressed={on}
                    >
                      {on && <Check size={13} />} {o.label}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ))}

          <button type="submit" className="btn btn-primary" disabled={!ready}>
            <MapPin size={15} /> Score my profile
          </button>
          {!ready && (
            <p style={{ fontSize: 12.5, color: "var(--faint)", margin: "8px 0 0" }}>
              Answer the questions above and your score appears here — no email needed,
              nothing sent anywhere.
            </p>
          )}
        </form>
      )}

      {error && !running && (
        <div className="panel panel-block" style={{ borderLeft: "3px solid var(--orange, #fb923c)" }}>
          <strong style={{ color: "var(--orange, #fb923c)" }}>
            <AlertTriangle size={15} style={{ verticalAlign: "-2px" }} /> {error}
          </strong>
        </div>
      )}

      {result && !running && (
        <div>
          <div className="aseo-head">
            <div className="aseo-dial">
              <svg width="104" height="104" viewBox="0 0 104 104" aria-hidden>
                <circle className="aseo-dial-track" cx="52" cy="52" r="44" fill="none" strokeWidth="8" />
                <circle
                  className="aseo-dial-fill"
                  cx="52"
                  cy="52"
                  r="44"
                  fill="none"
                  strokeWidth="8"
                  strokeLinecap="round"
                  stroke={colour(result.score)}
                  strokeDasharray={2 * Math.PI * 44}
                  strokeDashoffset={2 * Math.PI * 44 * (1 - result.score / 100)}
                />
              </svg>
              <div className="aseo-dial-num">
                <b style={{ color: colour(result.score) }}>{result.score}</b>
                <span>OUT OF 100</span>
              </div>
            </div>
            <div className="aseo-verdict">
              <p className="aseo-host">
                {result.name}
                {result.address ? ` · ${result.address}` : ""}
              </p>
              <h2>{result.verdict}</h2>
              <p>
                <Star size={12} style={{ verticalAlign: "-1px", fill: "var(--orange,#fb923c)", color: "var(--orange,#fb923c)" }} />{" "}
                {/* Never the representative number behind a band. Somebody who
                    answered "8–24" must not be shown "8 reviews" — it reads as
                    a lookup, and being wrong about a fact they gave us is the
                    fastest way to lose the whole report. */}
                {result.ratingLabel ?? (result.rating ? result.rating.toFixed(1) : "no rating")}
                {" · "}
                {result.reviewCountLabel ??
                  `${result.reviewCount} review${result.reviewCount === 1 ? "" : "s"}`}
              </p>
            </div>
          </div>

          {top ? (
            <>
              <p className="aseo-step-label">
                <AlertTriangle size={13} /> Fix this first
              </p>
              <div className={`aseo-hero${top.status === "warn" ? " is-warn" : ""}`}>
                <h3>{top.label}</h3>
                <div className="aseo-now">
                  <strong>Right now: </strong>
                  {top.found}
                </div>
                <div className="aseo-block">
                  <p className="aseo-block-label">Why it costs you</p>
                  <p>{top.why}</p>
                </div>
                <div className="aseo-block">
                  <p className="aseo-block-label">The fix</p>
                  <p>{top.fix}</p>
                </div>
              </div>

              {problems.length > 1 && (
                <>
                  <p className="aseo-step-label">Then these</p>
                  <div className="aseo-next">
                    {problems.slice(1, 3).map((f) => (
                      <div className="aseo-next-card" key={f.id}>
                        <strong>{f.label}</strong>
                        <span>{f.found}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          ) : (
            <p className="aseo-step-label" style={{ color: "var(--green, #34d399)" }}>
              <Check size={14} /> Every check passed — this profile is properly set up
            </p>
          )}

          {result.source === "self" && (
            /* Said plainly, under the score, not buried. The report is built
               from the visitor's own answers — presenting it as a lookup would
               be a lie about where the number came from, and the difference
               matters if they act on it. */
            <p style={{ fontSize: 12.5, color: "var(--faint)", margin: "10px 0 0" }}>
              Scored from your own answers, not a lookup — so it&apos;s only as right as
              they were. The advice under each point is the same either way.{" "}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setResult(null)}
              >
                Change an answer
              </button>
            </p>
          )}

          <details className="aseo-rest">
            <summary>See all {result.findings.length} checks</summary>
            <div style={{ marginTop: 8 }}>
              {result.findings.map((f) => {
                const meta = ICON[f.status];
                const Icon = meta.icon;
                return (
                  <div className="aseo-row" key={f.id}>
                    <span style={{ color: meta.colour, marginTop: 2 }} aria-hidden>
                      <Icon size={15} />
                    </span>
                    <div className="aseo-row-txt">
                      <strong>{f.label}</strong>
                      <span>{f.found}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </details>

          {/* The ONE tool that produced a full report and let the visitor
              walk away. Every other free tool captures here; this one was
              missed, and because it is gated behind GOOGLE_PLACES_API_KEY it
              would have gone live silently the moment the key was set.

              Same placement as the others: under a finished result, never in
              front of one. The report stays on screen either way. */}
          <ToolLeadForm
            tool="google-profile"
            subject={result.address ? `${result.name} · ${result.address}` : result.name}
            headline={`${result.score}/100 — ${result.verdict}`}
            topFinding={
              top ? `${top.label}: ${top.found}` : "Every check passed"
            }
            title="Want this sent to you?"
            blurb={
              problems.length > 0
                ? `Leave your email and we'll send the full ${result.findings.length}-point check over, plus the ${problems.length} thing${problems.length === 1 ? "" : "s"} to fix first and how long each takes.`
                : "Leave your email and we'll send the full check over — plus what to do next to hold the position you've got."
            }
          />

          <div className="panel panel-block" style={{ marginTop: 20, borderLeft: "3px solid var(--ac1, #8b5cf6)" }}>
            <strong>Reviews are the one that compounds</strong>
            <p style={{ fontSize: 13.5, color: "var(--faint)", margin: "6px 0 10px" }}>
              Everything else here is a one-off afternoon&apos;s work. Reviews need a habit —
              asking every customer, the day the job ends. That&apos;s the bit we automate,
              and it&apos;s the bit that moves you up the map pack.
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Link href="/book" className="btn btn-primary btn-sm">
                See how that works <ArrowRight size={13} />
              </Link>
              {result.mapsUri && (
                <a href={result.mapsUri} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
                  Open my profile
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
