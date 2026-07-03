"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Phase = "checking" | "ready" | "invalid" | "saving";

export function SetPasswordForm() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();

    async function establishSession() {
      // Supabase's verify endpoint redirects here with tokens in the URL
      // hash fragment (#access_token=...&refresh_token=...), or an error
      // (#error_description=...) if the link was already used or expired.
      const hash = new URLSearchParams(window.location.hash.slice(1));
      const errorDescription = hash.get("error_description");
      const accessToken = hash.get("access_token");
      const refreshToken = hash.get("refresh_token");

      if (errorDescription) {
        setError(errorDescription.replace(/\+/g, " "));
        setPhase("invalid");
        return;
      }

      if (accessToken && refreshToken) {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (sessionError) {
          setError(sessionError.message);
          setPhase("invalid");
          return;
        }
        // Remove the tokens from the address bar.
        window.history.replaceState(null, "", window.location.pathname);
        setPhase("ready");
        return;
      }

      // No tokens in the URL — maybe the session already exists (e.g. the
      // page was reloaded after the hash was consumed).
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        setPhase("ready");
      } else {
        setError(
          "This link is invalid or has expired. Ask for a new invite or password reset."
        );
        setPhase("invalid");
      }
    }

    establishSession();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    setPhase("saving");
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({
      password,
    });

    if (updateError) {
      setError(updateError.message);
      setPhase("ready");
      return;
    }

    // /portal's guard forwards admin accounts on to /admin.
    router.replace("/portal");
    router.refresh();
  }

  if (phase === "checking") {
    return <p style={{ fontSize: 13, color: "var(--body)" }}>Checking your link…</p>;
  }

  if (phase === "invalid") {
    return <p className="login-error">{error}</p>;
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column" }}>
      <label htmlFor="password">New password</label>
      <input
        id="password"
        type="password"
        required
        minLength={8}
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <label htmlFor="confirm">Confirm password</label>
      <input
        id="confirm"
        type="password"
        required
        minLength={8}
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
      />
      {error && <p className="login-error">{error}</p>}
      <button type="submit" disabled={phase === "saving"}>
        {phase === "saving" ? "Saving…" : "Set password & sign in"}
      </button>
    </form>
  );
}
