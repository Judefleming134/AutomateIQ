"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";

/**
 * Customer-facing accept / decline control on the public quote page. Posts
 * to the public route handler, which flips the quote status server-side.
 */
export function QuoteDecision({ token }: { token: string }) {
  const [pending, setPending] = useState<"accept" | "decline" | null>(null);
  const [done, setDone] = useState<"accepted" | "declined" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: "accept" | "decline") {
    if (pending) return;
    setPending(decision);
    setError(null);
    try {
      const res = await fetch(`/api/q/${token}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean } | null;
      if (res.ok && data?.ok) {
        setDone(decision === "accept" ? "accepted" : "declined");
      } else {
        setError("Something went wrong — please try again.");
      }
    } catch {
      setError("Network error — please try again.");
    } finally {
      setPending(null);
    }
  }

  if (done) {
    return (
      <div className={`quote-decided quote-decided-${done}`}>
        {done === "accepted"
          ? "✓ Thank you! Your quote is accepted — we'll be in touch to get started."
          : "Thanks for letting us know. This quote has been declined."}
      </div>
    );
  }

  return (
    <div className="quote-actions">
      <button
        type="button"
        className="btn btn-primary quote-accept"
        onClick={() => decide("accept")}
        disabled={pending !== null}
      >
        <Check size={16} /> {pending === "accept" ? "Accepting…" : "Accept quote"}
      </button>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => decide("decline")}
        disabled={pending !== null}
      >
        <X size={16} /> {pending === "decline" ? "…" : "Decline"}
      </button>
      {error && <p className="login-error">{error}</p>}
    </div>
  );
}
