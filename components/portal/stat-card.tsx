export function StatCard({
  label,
  value,
  icon,
  accent = "var(--ac2)",
}: {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  accent?: string;
}) {
  const style = {
    "--icon-bg": `color-mix(in srgb, ${accent} 16%, transparent)`,
    "--icon-fg": accent,
  } as React.CSSProperties;

  return (
    <div className="panel stat-card" style={style}>
      <div className="stat-card-icon">{icon}</div>
      <div className="stat-card-value">{value}</div>
      <div className="stat-card-label">{label}</div>
    </div>
  );
}
