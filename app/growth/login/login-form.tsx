"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * The Growth Engine's own sign-in screen. Same Supabase Auth infrastructure
 * as the platform, but a separate door: only Growth Engine team members
 * (see lib/growth/auth.ts) get past it, and it never links to or from the
 * customer portal.
 */
export default function GrowthLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const denied = searchParams.get("denied") === "1";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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

    const next = searchParams.get("next");
    router.replace(next && next.startsWith("/growth") ? next : "/growth");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="login-card">
      <div className="login-brand">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-aiq.png" alt="AutomateIQ" className="brand-logo" />
      </div>
      <h1>Growth Engine</h1>
      <p style={{ color: "var(--faint)", fontSize: 13, margin: "0 0 14px" }}>
        Internal sales &amp; outreach workspace — team access only.
      </p>
      {denied && (
        <p className="login-error">
          This account doesn&apos;t have Growth Engine access. Ask an owner to
          add you in Settings → Team.
        </p>
      )}
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
      <button type="submit" disabled={loading}>
        {loading ? "Signing in…" : "Sign in"}
      </button>
      <p style={{ fontSize: 12, color: "var(--faint, #6f6f7a)", marginTop: 14, textAlign: "center" }}>
        Need help? Contact us at{" "}
        <a href="mailto:hello@automateiq.ie" style={{ color: "var(--ac2, #3b82f6)" }}>
          hello@automateiq.ie
        </a>
      </p>
    </form>
  );
}
