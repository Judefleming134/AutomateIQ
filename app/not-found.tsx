import Link from "next/link";

export default function NotFound() {
  return (
    <main className="login-page">
      <div className="login-card" style={{ textAlign: "center" }}>
        <div className="login-brand" style={{ justifyContent: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-aiq.png" alt="AutomateIQ" className="brand-logo" />
        </div>
        <p
          style={{
            fontFamily: "var(--mono)",
            fontSize: 12,
            letterSpacing: "0.14em",
            color: "var(--faint)",
            margin: "0 0 6px",
          }}
        >
          404 / NOT FOUND
        </p>
        <h1 style={{ marginBottom: 8 }}>This page doesn&apos;t exist</h1>
        <p style={{ fontSize: 13.5, color: "var(--body)", margin: "0 0 20px" }}>
          The link may be out of date, or the page may have moved.
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          <Link href="/portal" className="btn btn-primary">
            Go to dashboard
          </Link>
          <a href="/" className="btn btn-secondary">
            automateiq.ie
          </a>
        </div>
      </div>
    </main>
  );
}
