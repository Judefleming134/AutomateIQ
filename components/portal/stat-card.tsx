import { CountUp } from "./count-up";

export function StatCard({
  label,
  value,
  icon,
  accent = "var(--ac2)",
  hint,
}: {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  accent?: string;
  hint?: string;
}) {
  const style = {
    "--icon-bg": `color-mix(in srgb, ${accent} 16%, transparent)`,
    "--icon-fg": accent,
  } as React.CSSProperties;

  return (
    <div className="panel stat-card" style={style}>
      <div className="stat-card-row">
        <div className="stat-card-icon">{icon}</div>
        {hint && <span className="stat-card-hint">{hint}</span>}
      </div>
      <div className="stat-card-value">
        {typeof value === "number" ? <CountUp value={value} /> : value}
      </div>
      <div className="stat-card-label">{label}</div>
    </div>
  );
}
