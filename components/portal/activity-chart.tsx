export type DayBucket = { label: string; count: number };

/**
 * Buckets a list of ISO timestamps into per-day counts for the last
 * `days` days (oldest first). Pure function — runs server-side.
 */
export function bucketByDay(timestamps: string[], days: number): DayBucket[] {
  const buckets: DayBucket[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(today);
    day.setDate(day.getDate() - i);
    buckets.push({
      label: day.toLocaleDateString("en-IE", { day: "numeric", month: "short" }),
      count: 0,
    });
  }

  const startMs = today.getTime() - (days - 1) * 86_400_000;
  for (const ts of timestamps) {
    const t = new Date(ts);
    t.setHours(0, 0, 0, 0);
    const idx = Math.round((t.getTime() - startMs) / 86_400_000);
    if (idx >= 0 && idx < buckets.length) buckets[idx].count++;
  }

  return buckets;
}

export function ActivityBarChart({
  buckets,
  accent = "var(--ac2)",
}: {
  buckets: DayBucket[];
  accent?: string;
}) {
  const max = Math.max(1, ...buckets.map((b) => b.count));

  return (
    <div style={{ "--chart-accent": accent } as React.CSSProperties}>
      <div className="chart-bars" role="img" aria-label="Review requests per day">
        {buckets.map((b, i) => (
          <div
            key={i}
            className={`chart-bar${b.count === 0 ? " is-empty" : ""}`}
            style={{ height: `${Math.max(3, (b.count / max) * 100)}%` }}
            title={`${b.label}: ${b.count}`}
          />
        ))}
      </div>
      <div className="chart-x">
        <span>{buckets[0]?.label}</span>
        <span>{buckets[buckets.length - 1]?.label}</span>
      </div>
    </div>
  );
}
