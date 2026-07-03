import { Sparkles } from "lucide-react";

export function ComingSoon({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <>
      <div className="page-header">
        <div>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
      </div>
      <div className="panel" style={{ padding: "48px 32px", textAlign: "center" }}>
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 14,
            display: "grid",
            placeItems: "center",
            background: "var(--ac2-soft)",
            color: "var(--ac2)",
            margin: "0 auto 16px",
          }}
        >
          <Sparkles size={22} />
        </div>
        <h3 style={{ marginBottom: 6 }}>Coming soon</h3>
        <p style={{ fontSize: 13, color: "var(--body)", margin: 0 }}>
          We&apos;re building this module — check back soon.
        </p>
      </div>
    </>
  );
}
