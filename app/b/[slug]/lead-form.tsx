"use client";

import { useState, type FormEvent } from "react";

export function LeadForm({ slug }: { slug: string }) {
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [message, setMessage] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">(
    "idle"
  );

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setState("sending");
    try {
      const res = await fetch("/api/wa-lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, name, contact, message }),
      });
      setState(res.ok ? "sent" : "error");
    } catch {
      setState("error");
    }
  }

  if (state === "sent") {
    return (
      <p className="wa-sent">
        ✓ Thanks — your message is on its way. We&apos;ll be in touch soon.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="wa-form">
      <input
        type="text"
        placeholder="Your name"
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        type="text"
        placeholder="Email or phone"
        required
        value={contact}
        onChange={(e) => setContact(e.target.value)}
      />
      <textarea
        placeholder="What do you need?"
        rows={4}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
      />
      <button type="submit" disabled={state === "sending"}>
        {state === "sending" ? "Sending…" : "Send enquiry"}
      </button>
      {state === "error" && (
        <p className="wa-error">Something went wrong — please try again.</p>
      )}
    </form>
  );
}
