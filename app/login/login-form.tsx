"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  async function handleForgotPassword() {
    setError(null);
    if (!email.trim()) {
      setError("Enter your email above first, then tap Forgot password.");
      return;
    }
    const supabase = createClient();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email.trim(),
      { redirectTo: `${window.location.origin}/auth/set-password` }
    );
    if (resetError) {
      setError(resetError.message);
      return;
    }
    setResetSent(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setLoading(false);

    if (signInError) {
      setError("Incorrect email or password.");
      return;
    }

    // Land on /portal by default — its layout redirects admin accounts to
    // /admin. This is the single entry point for both account types.
    const next = searchParams.get("next") || "/portal";
    router.replace(next);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="login-card">
      <div className="login-brand">
        <span className="sidebar-brand-mark">Iq</span>
        AutomateIQ
      </div>
      <h1>Sign in to your account</h1>
      <label htmlFor="email">Email</label>
      <input
        id="email"
        type="email"
        required
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <label htmlFor="password">Password</label>
      <input
        id="password"
        type="password"
        required
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {error && <p className="login-error">{error}</p>}
      {resetSent && (
        <p style={{ color: "var(--green, #34d399)", fontSize: 13, margin: "6px 0 0" }}>
          ✓ Reset link sent — check your inbox, then set a new password.
        </p>
      )}
      <button type="submit" disabled={loading}>
        {loading ? "Signing in…" : "Sign in"}
      </button>
      <button
        type="button"
        onClick={handleForgotPassword}
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
        Forgot password?
      </button>
    </form>
  );
}
