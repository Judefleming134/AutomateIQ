"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Copy,
  Loader2,
  Search,
  TriangleAlert,
  X,
} from "lucide-react";
import type { SeoAudit, SeoCheck } from "@/lib/seo/audit";

const STATUS_META = {
  pass: { icon: Check, colour: "var(--green, #34d399)", word: "Good" },
  warn: { icon: TriangleAlert, colour: "var(--orange, #fb923c)", word: "Could be better" },
  fail: { icon: X, colour: "var(--red, #f87171)", word: "Needs fixing" },
} as const;

const IMPACT_WORD = {
  high: "Big impact",
  medium: "Worth doing",
  low: "Nice to have",
} as const;

function scoreColour(score: number) {
  if (score >= 75) return "var(--green, #34d399)";
  if (score >= 50) return "var(--orange, #fb923c)";
  return "var(--red, #f87171)";
}

/** Copy button that confirms in place — no toast system needed. */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          // Clipboard blocked (insecure context / permissions) — the code is
          // on screen and selectable, so this is a convenience, not the path.
          setCopied(false);
        }
      }}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy"}
    </button>
  );
}

function CheckRow({ check }: { check: SeoCheck }) {
  const [open, setOpen] = useState(check.status === "fail" && check.impact === "high");
  const meta = STATUS_META[check.status];
  const Icon = meta.icon;

  return (
    <div
      style={{
        borderTop: "1px solid var(--line, rgba(255,255,255,.08))",
        padding: "12px 0",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          display: "flex",
          gap: 10,
          alignItems: "flex-start",
          width: "100%",
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
          textAlign: "left",
          color: "inherit",
          font: "inherit",
        }}
      >
        <span style={{ color: meta.colour, flexShrink: 0, marginTop: 2 }} aria-hidden>
          <Icon size={16} />
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
            <strong>{check.label}</strong>
            <span style={{ fontSize: 11, color: "var(--faint)" }}>
              {meta.word} · {IMPACT_WORD[check.impact]}
            </span>
          </span>
          <span
            style={{
              display: "block",
              fontSize: 13,
              color: "var(--faint)",
              marginTop: 3,
            }}
          >
            {check.found}
          </span>
        </span>
        <span
          style={{
            color: "var(--faint)",
            flexShrink: 0,
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform .15s",
          }}
          aria-hidden
        >
          <ChevronDown size={16} />
        </span>
      </button>

      {open && (
        <div style={{ margin: "10px 0 0 26px", fontSize: 13.5, lineHeight: 1.6 }}>
          <p style={{ margin: "0 0 8px", color: "var(--faint)" }}>{check.why}</p>
          <p style={{ margin: "0 0 8px" }}>
            <strong>What to do:</strong> {check.fix}
          </p>
          {check.snippet && (
            <div style={{ marginTop: 8 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 4,
                }}
              >
                <span style={{ fontSize: 11.5, color: "var(--faint)" }}>
                  Paste this into your site — replace anything in [square brackets]
                </span>
                <CopyButton text={check.snippet} />
              </div>
              <pre
                style={{
                  background: "var(--bg2, rgba(255,255,255,.04))",
                  border: "1px solid var(--line, rgba(255,255,255,.08))",
                  borderRadius: 8,
                  padding: 12,
                  overflowX: "auto",
                  fontSize: 12,
                  margin: 0,
                  whiteSpace: "pre",
                }}
              >
                <code>{check.snippet}</code>
              </pre>
            </div>
          )}
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

  const failures = audit?.checks.filter((c) => c.status === "fail") ?? [];
  const warnings = audit?.checks.filter((c) => c.status === "warn") ?? [];
  const passes = audit?.checks.filter((c) => c.status === "pass") ?? [];
  // Lead with what actually costs money: big-impact failures first.
  const ordered = audit
    ? [...failures, ...warnings, ...passes].sort((a, b) => {
        const rank = { fail: 0, warn: 1, pass: 2 } as const;
        if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
        const imp = { high: 0, medium: 1, low: 2 } as const;
        return imp[a.impact] - imp[b.impact];
      })
    : [];

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
          Reading your homepage, robots.txt and sitemap the way Google would. This takes
          up to twenty seconds — slow sites take the longest, which is itself worth
          knowing.
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
          {/* Score header */}
          <div
            className="panel panel-block"
            style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center" }}
          >
            <div style={{ textAlign: "center", flexShrink: 0 }}>
              <div
                style={{
                  fontSize: 46,
                  fontWeight: 700,
                  lineHeight: 1,
                  color: scoreColour(audit.score),
                }}
              >
                {audit.score}
              </div>
              <div style={{ fontSize: 12, color: "var(--faint)" }}>out of 100</div>
            </div>
            <div style={{ flex: "1 1 260px" }}>
              <strong style={{ fontSize: 17 }}>{audit.host}</strong>
              <p style={{ fontSize: 13.5, color: "var(--faint)", margin: "4px 0 0" }}>
                {failures.length} thing{failures.length === 1 ? "" : "s"} to fix ·{" "}
                {warnings.length} could be better · {passes.length} already good
              </p>
              {audit.facts.redirectedTo && (
                <p style={{ fontSize: 12, color: "var(--faint)", margin: "4px 0 0" }}>
                  Redirected to {audit.facts.redirectedTo}
                </p>
              )}
            </div>
          </div>

          {/* The showstoppers — nothing else matters until these are fixed. */}
          {audit.blockers.length > 0 && (
            <div
              className="panel panel-block"
              style={{
                borderLeft: "3px solid var(--red, #f87171)",
                marginTop: 12,
              }}
            >
              <strong style={{ color: "var(--red, #f87171)" }}>
                <AlertTriangle size={15} style={{ verticalAlign: "-2px" }} /> Read this
                first — your site is effectively invisible to Google
              </strong>
              <p style={{ fontSize: 13.5, margin: "6px 0 0" }}>
                {audit.blockers.map((b) => b.label).join(" and ")} — until that&apos;s
                sorted, none of the other improvements below will make any difference,
                because Google isn&apos;t reading the page at all. Your score is capped
                for that reason. Fix it and re-run this check.
              </p>
            </div>
          )}

          <div className="panel panel-block" style={{ marginTop: 12 }}>
            <p style={{ fontSize: 12, color: "var(--faint)", margin: "0 0 4px" }}>
              Biggest problems first. Tap any line for the why and the fix.
            </p>
            {ordered.map((c) => (
              <CheckRow key={c.id} check={c} />
            ))}
          </div>

          <div
            className="panel panel-block"
            style={{ marginTop: 12, borderLeft: "3px solid var(--ac1, #8b5cf6)" }}
          >
            <strong>Want this done rather than described?</strong>
            <p style={{ fontSize: 13.5, color: "var(--faint)", margin: "6px 0 10px" }}>
              Everything above is yours to use, free — copy the code and it&apos;s
              sorted. If you&apos;d rather not touch it yourself, we do it for you: the
              fixes applied, your Google Business Profile straightened out, and the site
              checked again afterwards so you can see it worked.
            </p>
            <Link href="/book" className="btn btn-primary btn-sm">
              Talk to us about fixing it
            </Link>
          </div>

          <p style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 10 }}>
            Checked {new Date(audit.fetchedAt).toLocaleString("en-IE")} · read{" "}
            {audit.finalUrl} · nothing on your site was changed.
          </p>
        </div>
      )}
    </div>
  );
}
