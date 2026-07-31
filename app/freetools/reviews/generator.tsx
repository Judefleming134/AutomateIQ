"use client";

import { useState } from "react";
import { ToolLeadForm } from "@/components/tools/tool-lead-form";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Check, Copy, Loader2, Star } from "lucide-react";

type Reply = { tone: string; text: string };
type Result = { replies: Reply[]; read: string; warning: string };

function CopyBtn({ text }: { text: string }) {
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
          setCopied(false);
        }
      }}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy"}
    </button>
  );
}

export function ReviewReplyGenerator() {
  const [review, setReview] = useState("");
  const [business, setBusiness] = useState("");
  const [rating, setRating] = useState(0);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (running) return;
    if (review.trim().length < 15) {
      setError("Paste a bit more of the review — at least a sentence.");
      return;
    }
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/tools/review-reply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          review: review.trim(),
          business: business.trim() || undefined,
          rating: rating || undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) setError(data?.error ?? "Couldn't write the replies. Try again.");
      else setResult(data as Result);
    } catch {
      setError("Couldn't reach the writer — check your connection and try again.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div>
      <form onSubmit={run} style={{ marginBottom: 20 }}>
        <label htmlFor="rv-text">
          <strong>Paste the review</strong>
        </label>
        <textarea
          id="rv-text"
          rows={5}
          value={review}
          onChange={(e) => setReview(e.target.value)}
          maxLength={2000}
          placeholder="Rang three times over two days and never got a call back. Ended up going with someone else. Shame because they were recommended to me."
          disabled={running}
          style={{ marginTop: 6 }}
        />

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 12 }}>
          <div style={{ flex: "1 1 220px" }}>
            <label htmlFor="rv-biz" style={{ fontSize: 13.5 }}>
              Your business name <span style={{ color: "var(--faint)" }}>(optional)</span>
            </label>
            <input
              id="rv-biz"
              value={business}
              onChange={(e) => setBusiness(e.target.value)}
              maxLength={120}
              placeholder="Murphy Plumbing"
              disabled={running}
              style={{ width: "100%", marginTop: 4 }}
            />
          </div>
          <div>
            <span style={{ fontSize: 13.5, display: "block", marginBottom: 4 }}>
              Star rating <span style={{ color: "var(--faint)" }}>(optional)</span>
            </span>
            <div style={{ display: "flex", gap: 3 }} role="radiogroup" aria-label="Star rating">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={rating === n}
                  aria-label={`${n} star${n === 1 ? "" : "s"}`}
                  onClick={() => setRating(rating === n ? 0 : n)}
                  className="btn btn-ghost btn-sm"
                  style={{ padding: "6px 7px" }}
                >
                  <Star
                    size={16}
                    style={{
                      fill: n <= rating ? "var(--orange, #fb923c)" : "transparent",
                      color: n <= rating ? "var(--orange, #fb923c)" : "var(--faint)",
                    }}
                  />
                </button>
              ))}
            </div>
          </div>
        </div>

        <button type="submit" className="btn btn-primary" disabled={running} style={{ marginTop: 14 }}>
          {running ? (
            <>
              <Loader2 size={15} className="book-spin" /> Writing…
            </>
          ) : (
            <>Write my replies</>
          )}
        </button>
      </form>

      {error && !running && (
        <div className="panel panel-block" style={{ borderLeft: "3px solid var(--red, #f87171)" }}>
          <strong style={{ color: "var(--red, #f87171)" }}>
            <AlertTriangle size={15} style={{ verticalAlign: "-2px" }} /> {error}
          </strong>
        </div>
      )}

      {result && !running && (
        <div>
          {/* A review alleging injury, discrimination or a legal matter is not
              something to answer from a free tool. Say so, loudly, first. */}
          {result.warning && (
            <div
              className="panel panel-block"
              style={{ borderLeft: "3px solid var(--red, #f87171)", marginBottom: 14 }}
            >
              <strong style={{ color: "var(--red, #f87171)" }}>
                <AlertTriangle size={15} style={{ verticalAlign: "-2px" }} /> Don&apos;t post
                anything yet
              </strong>
              <p style={{ fontSize: 13.5, margin: "6px 0 0" }}>{result.warning}</p>
            </div>
          )}

          {result.read && (
            <div className="aseo-head" style={{ marginBottom: 18 }}>
              <div className="aseo-verdict">
                <p className="aseo-block-label">What they actually want</p>
                <h2 style={{ fontSize: 17 }}>{result.read}</h2>
              </div>
            </div>
          )}

          <p className="aseo-step-label">Pick the one that sounds like you</p>
          <div style={{ display: "grid", gap: 12 }}>
            {result.replies.map((r, i) => (
              <div className="aseo-next-card" key={i}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    alignItems: "center",
                    flexWrap: "wrap",
                    marginBottom: 8,
                  }}
                >
                  <strong style={{ margin: 0 }}>{r.tone}</strong>
                  <CopyBtn text={r.text} />
                </div>
                <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                  {r.text}
                </p>
              </div>
            ))}
          </div>

          <p style={{ fontSize: 12, color: "var(--faint)", marginTop: 12 }}>
            Read it before you post it. These are written without knowing what actually
            happened — if any detail is wrong, change it. Never post a reply that claims
            something you can&apos;t stand over.
          </p>

          <ToolLeadForm
            tool="reviews"
            headline={`${result.replies.length} replies written`}
            title="Want these sent to you?"
            blurb="Leave your email and we'll send the three replies over, plus how we'd set this up to run on every review automatically."
          />

          <div
            className="panel panel-block"
            style={{ marginTop: 20, borderLeft: "3px solid var(--ac1, #8b5cf6)" }}
          >
            <strong>This is the slow way</strong>
            <p style={{ fontSize: 13.5, color: "var(--faint)", margin: "6px 0 10px" }}>
              Doing this by hand means you only reply to the ones that sting. The
              businesses that climb the map pack reply to every review within a day —
              which is a system, not a resolution. We build that.
            </p>
            <Link href="/book" className="btn btn-primary btn-sm">
              Have it done automatically <ArrowRight size={13} />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
