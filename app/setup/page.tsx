import { BootstrapAdminForm } from "./form";

// One-time, unauthenticated setup page — safe to leave in place, since the
// underlying API route (see app/api/setup/bootstrap-admin/route.ts) is
// itself gated by SETUP_SECRET and permanently refuses to run a second
// time once any admin exists. This page just gives that endpoint a normal
// form UI instead of requiring a manual JSON request.
export default function SetupPage() {
  return (
    <main className="login-page">
      <div className="login-card">
        <div className="login-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-aiq.png" alt="AutomateIQ" className="brand-logo" />
        </div>
        <h1>Bootstrap first admin</h1>
        <p style={{ fontSize: 13, color: "var(--body)", margin: "0 0 4px" }}>
          One-time setup. Enter your email and the SETUP_SECRET value from
          Vercel — you&apos;ll get an invite email to set a password and sign in.
        </p>
        <BootstrapAdminForm />
      </div>
    </main>
  );
}
