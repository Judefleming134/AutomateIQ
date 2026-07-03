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
        body: JSON.stringify({ email, secret }),
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
        type="password"
        required
        autoComplete="off"
        value={secret}
        onChange={(e) => setSecret(e.target.value)}
      />
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
