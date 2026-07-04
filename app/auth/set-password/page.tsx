import { SetPasswordForm } from "./form";

// Landing page for Supabase invite / password-recovery email links.
// The email link hits Supabase's /auth/v1/verify endpoint, which redirects
// here with session tokens in the URL hash fragment — the client form
// picks those up, establishes the session, and lets the user set a
// password. Must be listed in the Supabase project's Redirect URLs.
export default function SetPasswordPage() {
  return (
    <main className="login-page">
      <div className="login-card">
        <div className="login-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-aiq.png" alt="AutomateIQ" className="brand-logo" />
        </div>
        <h1>Set your password</h1>
        <SetPasswordForm />
      </div>
    </main>
  );
}
