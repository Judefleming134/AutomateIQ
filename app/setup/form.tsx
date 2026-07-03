"use client";

import { useState, type FormEvent } from "react";

export function BootstrapAdminForm() {
  const [email, setEmail] = useState("");
  const [secret, setSecret] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(
    null
  );

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setResult(null);

    try {
      const res = await fetch("/api/setup/bootstrap-admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // .trim() guards against a stray leading/trailing space or newline
        // sneaking in from a copy-paste, which would otherwise silently
        // make an exact-match secret comparison fail.
        body: JSON.stringify({ email: email.trim(), secret: secret.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setResult({
          ok: true,
          text: data.message || "Invite sent. Check your inbox.",
        });
      } else {
        setResult({ ok: false, text: data.error || `Error (${res.status})` });
      }
    } catch {
      setResult({ ok: false, text: "Network error — please try again." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor="email">Your email</label>
      <input
        id="email"
        type="email"
        required
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <label htmlFor="secret">SETUP_SECRET</label>
      <input
        id="secret"
        type="text"
        required
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        value={secret}
        onChange={(e) => setSecret(e.target.value)}
      />
      <p style={{ fontSize: 11, color: "var(--faint, #6f6f7a)", margin: "2px 0 0" }}>
        {secret.length} characters entered — check this matches the length
        of the value in Vercel.
      </p>
      <button type="submit" disabled={loading}>
        {loading ? "Sending…" : "Create first admin"}
      </button>
      {result && (
        <p className={result.ok ? undefined : "login-error"} style={result.ok ? { color: "var(--green, #34d399)", fontSize: 13, marginTop: 6 } : undefined}>
          {result.text}
        </p>
      )}
    </form>
  );
}
