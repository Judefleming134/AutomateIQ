import Link from "next/link";

/**
 * Shared chrome for the free tools. Every one of them is a front door for
 * someone who has never heard of AutomateIQ, so each page carries the same
 * header, the same way back to the others, and the same one-line promise.
 */
export default function ToolsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="book-page sv-page">
      <header className="book-topbar">
        <Link href="/" className="book-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-aiq.png" alt="AutomateIQ" />
        </Link>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Link href="/freetools" className="btn btn-ghost btn-sm">
            All free tools
          </Link>
          <Link href="/book" className="btn btn-primary btn-sm">
            Book a strategy session
          </Link>
        </div>
      </header>
      {children}
    </div>
  );
}
