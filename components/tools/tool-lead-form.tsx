"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Mail } from "lucide-react";
import type { ToolSlug } from "@/lib/tools/slugs";

/**
 * "Send it to me" — the ONE place a free tool asks for an email.
 *
 * It appears under a finished result, never in front of one. The report is
 * already fully on screen and stays there whatever happens here; this is the
 * visitor asking for something back, which is also the only thing the tool
 * copy has ever promised ("nothing is stored unless you ask us to email it to
 * you"). Gating the result behind an address would collect more emails and
 * fewer customers, and would make that promise untrue.
 *
 * Failure is deliberately quiet. They already have what they came for, and a
 * red error under a working report reads as "the tool broke".
 */
export function ToolLeadForm({
  tool,
  subject,
  headline,
  topFinding,
  title = "Want this sent to you?",
  blurb,
}: {
  tool: ToolSlug;
  subject?: string | null;
  headline?: string | null;
  topFinding?: string | null;
  title?: string;
  blurb?: string;
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
      await fetch("/api/tools/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: value, tool, subject, headline, topFinding }),
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
      <div className="panel panel-block ft-lead ft-lead-done" role="status">
        <span className="ft-lead-tick" aria-hidden>
          <Check size={17} />
        </span>
        <div>
          <strong>Got it — we&apos;ll be in touch.</strong>
          <p>
            A real person reads these. If you&apos;d rather not wait,{" "}
            <Link href="/book">grab fifteen minutes</Link> and we&apos;ll go through it
            with you.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="panel panel-block ft-lead">
      <strong>
        <Mail size={14} aria-hidden /> {title}
      </strong>
      <p>
        {blurb ??
          "Leave your email and we'll send this over and follow up with what we'd fix first. No list, no drip campaign — one reply from a person."}
      </p>
      <form className="ft-lead-form" onSubmit={submit} noValidate>
        <label className="sr-only" htmlFor={`lead-${tool}`}>
          Your email address
        </label>
        <input
          id={`lead-${tool}`}
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@yourbusiness.ie"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (note) setNote("");
          }}
          disabled={state === "sending"}
        />
        <button type="submit" className="btn btn-primary" disabled={state === "sending"}>
          {state === "sending" ? "Sending…" : "Send it over"}
          {state === "idle" && <ArrowRight size={14} />}
        </button>
        {note && (
          <p className="ft-lead-note" role="alert">
            {note}
          </p>
        )}
      </form>
      <p className="ft-lead-small">
        Your report is already yours — it stays on screen whether you do this or not.
      </p>
    </div>
  );
}
