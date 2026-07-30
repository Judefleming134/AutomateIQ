"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Check, Loader2, MapPin, Star, TriangleAlert, X } from "lucide-react";

type Finding = {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail";
  impact: "high" | "medium" | "low";
  found: string;
  why: string;
  fix: string;
};
type Result = {
  name: string;
  address: string;
  rating: number | null;
  reviewCount: number;
  mapsUri: string | null;
  score: number;
  verdict: string;
  findings: Finding[];
};

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

  if (!configured) {
    return (
      <div className="aseo-hero is-warn">
        <h3>Not switched on yet</h3>
        <div className="aseo-now">
          This checker needs a Google API key, which isn&apos;t configured on this site yet.
        </div>
        <div className="aseo-block">
          <p className="aseo-block-label">In the meantime</p>
          <p>
            The website checker covers the signals Google uses to match your site to your
            Business Profile — your name, address and phone, and your business schema.
            That&apos;s the half you control directly, and it&apos;s free right now.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
          <Link href="/autoseo" className="btn btn-primary btn-sm">
            Check my website instead <ArrowRight size={13} />
          </Link>
          <Link href="/tools" className="btn btn-secondary btn-sm">
            All free tools
          </Link>
        </div>
      </div>
    );
  }

  const problems = result?.findings.filter((f) => f.status !== "pass") ?? [];
  const top = problems[0];

  return (
    <div>
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
                {result.rating ? result.rating.toFixed(1) : "no rating"} · {result.reviewCount} review
                {result.reviewCount === 1 ? "" : "s"}
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
