"use client";

import { useState } from "react";
import { ArrowRight, Check } from "lucide-react";

/**
 * The second door on every product page.
 *
 * Posts to /api/lead, which already stores the lead, emails the visitor and
 * alerts Jude. The only thing added here is `source`, so a request from the
 * PermitIQ page is attributable to PermitIQ instead of landing in the same
 * undifferentiated pile as the homepage form.
 *
 * The failure handling is deliberate: a network error still shows success,
 * because /api/lead is fire-and-forget on the homepage too and a visitor who
 * sees "something went wrong" after typing their email simply leaves. What it
 * does NOT do is claim success before the request has been attempted — the
 * button only flips after the fetch settles.
 */
export function RequestAccessForm({
  source,
  productName,
  accent,
}: {
  source: string;
  productName: string;
  accent: string;
}) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [note, setNote] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (state !== "idle") return;

    const value = email.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
      setNote("Please enter a valid email address.");
      return;
    }

    setNote("");
    setState("sending");
    try {
      await fetch("/api/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: value, source }),
      });
    } catch {
      // Swallowed on purpose — see the note above.
    } finally {
      setState("done");
      setEmail("");
    }
  }

  if (state === "done") {
    return (
      <div className="prod-access-done" role="status">
        <span className="prod-access-tick" style={{ color: accent }}>
          <Check size={18} />
        </span>
        <div>
          <strong>Request received.</strong>
          <p>
            We&apos;ll be in touch shortly about {productName}. Check your inbox for a
            confirmation — if it&apos;s not there in a few minutes, look in spam.
          </p>
        </div>
      </div>
    );
  }

  return (
    <form className="prod-access-form" onSubmit={submit} noValidate>
      <label className="sr-only" htmlFor={`access-${source}`}>
        Your email address
      </label>
      <input
        id={`access-${source}`}
        type="email"
        inputMode="email"
        autoComplete="email"
        placeholder="you@yourcompany.ie"
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          if (note) setNote("");
        }}
        disabled={state === "sending"}
      />
      <button
        type="submit"
        className="btn btn-primary"
        disabled={state === "sending"}
      >
        {state === "sending" ? "Sending…" : "Request access"}
        {state === "idle" && <ArrowRight size={15} />}
      </button>
      {note && (
        <p className="prod-access-note" role="alert">
          {note}
        </p>
      )}
    </form>
  );
}
