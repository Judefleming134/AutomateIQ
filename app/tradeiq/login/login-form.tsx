"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Self-serve sign-up + sign-in for tradespeople. One screen, a mode toggle.
 * Sign-up creates the Supabase auth user; the account row itself is created
 * on first authenticated visit (see requireTradesAccount). If the project has
 * email confirmation on, sign-up returns no session and we tell them to check
 * their inbox rather than silently doing nothing.
 */
export default function TradesLoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<"signin" | "signup">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const next = params.get("next") || "/tradeiq";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    setLoading(true);
    const supabase = createClient();

    if (mode === "signup") {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || window.location.origin}/tradeiq`,
        },
      });
      setLoading(false);
      if (signUpError) {
        setError(signUpError.message);
        return;
      }
      // No session back = email confirmation is required for this project.
      if (!data.session) {
        setNotice(
          "Account created — check your email to confirm it, then sign in."
        );
        setMode("signin");
        return;
      }
      router.replace(next);
      router.refresh();
      return;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setLoading(false);
    if (signInError) {
      setError("Incorrect email or password.");
      return;
    }
    router.replace(next);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="login-card">
      <div className="login-brand">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-aiq.png" alt="AutomateIQ" className="brand-logo" />
      </div>
      <h1>{mode === "signup" ? "Create your account" : "Sign in"}</h1>
      <p style={{ fontSize: 13.5, color: "var(--faint, #6f6f7a)", margin: "0 0 14px" }}>
        Quotes &amp; invoices for your trade — send them in seconds, get paid faster.
      </p>

      {/* Mirror of the Finance login's TradeIQ box: one account system, so a
          Finance user signing in here is linked automatically. */}
      <div
        style={{
          border: "1px solid rgba(59,130,246,.35)",
          background: "rgba(59,130,246,.08)",
          borderRadius: 10,
          padding: "10px 12px",
          margin: "0 0 14px",
          fontSize: 13,
        }}
      >
        <strong>Already using our Finance tool?</strong>{" "}
        <button
          type="button"
          onClick={() => {
            setMode("signin");
            setError(null);
            setNotice(null);
          }}
          style={{
            background: "none",
            border: 0,
            padding: 0,
            color: "var(--ac2, #3b82f6)",
            cursor: "pointer",
            fontSize: 13,
            boxShadow: "none",
            textDecoration: "underline",
          }}
        >
          Sign in with your Finance login
        </button>{" "}
        — same account, everything already linked: your bills, scans and
        connections carry straight over.
      </div>

      <label htmlFor="t-email">Email</label>
      <input
        id="t-email"
        type="email"
        required
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <label htmlFor="t-password">Password</label>
      <input
        id="t-password"
        type="password"
        required
        autoComplete={mode === "signup" ? "new-password" : "current-password"}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />

      {error && <p className="login-error">{error}</p>}
      {notice && (
        <p style={{ color: "var(--green, #34d399)", fontSize: 13, margin: "6px 0 0" }}>
          ✓ {notice}
        </p>
      )}

      <button type="submit" disabled={loading}>
        {loading
          ? mode === "signup"
            ? "Creating account…"
            : "Signing in…"
          : mode === "signup"
            ? "Create account"
            : "Sign in"}
      </button>

      <button
        type="button"
        onClick={() => {
          setMode(mode === "signup" ? "signin" : "signup");
          setError(null);
          setNotice(null);
        }}
        style={{
          marginTop: 12,
          background: "none",
          border: 0,
          color: "var(--ac2, #3b82f6)",
          fontSize: 13,
          cursor: "pointer",
          boxShadow: "none",
          padding: 0,
        }}
      >
        {mode === "signup"
          ? "Already have an account? Sign in"
          : "New here? Create an account"}
      </button>
    </form>
  );
}
