import { CheckCircle2, Lock } from "lucide-react";

/**
 * Rich "coming soon" page body for products that exist in the registry but
 * haven't shipped yet — sells what's coming instead of a bare placeholder,
 * without pretending anything is functional.
 */
export function ProductPreview({
  name,
  tagline,
  accent,
  icon,
  features,
  note = "Want it first? It'll be enabled for your account the moment it launches — no setup needed on your side.",
}: {
  name: string;
  tagline: string;
  accent: string;
  icon: React.ReactNode;
  features: string[];
  note?: string;
}) {
  return (
    <>
      <div className="page-header">
        <div>
          <h1>{name}</h1>
          <p>{tagline}</p>
        </div>
        <span className="badge badge-gray">
          <Lock size={11} /> Coming soon
        </span>
      </div>

      <div
        className="panel product-preview"
        style={{ "--pp-accent": accent } as React.CSSProperties}
      >
        <div className="product-preview-icon">{icon}</div>
        <h2 style={{ fontSize: 16, marginBottom: 4 }}>What&apos;s coming</h2>
        <p style={{ margin: 0, fontSize: 13.5, color: "var(--body)" }}>
          Here&apos;s what this module will do for your business:
        </p>
        <ul className="preview-features">
          {features.map((feature) => (
            <li key={feature}>
              <CheckCircle2 size={16} />
              {feature}
            </li>
          ))}
        </ul>
        <p className="preview-note">{note}</p>
      </div>
    </>
  );
}
