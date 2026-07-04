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

/**
 * Single-series bar chart: recessive gridlines, thin bars with rounded
 * data ends anchored to the baseline, per-bar hover tooltip. Server
 * rendered; tooltips are CSS-only.
 */
export function ActivityBarChart({
  buckets,
  accent = "var(--chart-2)",
  unit = "requests",
}: {
  buckets: DayBucket[];
  accent?: string;
  unit?: string;
}) {
  const max = Math.max(1, ...buckets.map((b) => b.count));

  return (
    <div className="viz" style={{ "--chart-accent": accent } as React.CSSProperties}>
      <div style={{ position: "relative" }}>
        {/* Recessive gridlines at 50% and 100% of max */}
        {[0.5, 1].map((f) => (
          <div
            key={f}
            aria-hidden
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: `${f * 100}%`,
              borderTop: "1px dashed rgba(255,255,255,0.06)",
            }}
          />
        ))}
        <span
          aria-hidden
          style={{
            position: "absolute",
            right: 0,
            top: -6,
            fontFamily: "var(--mono)",
            fontSize: 9,
            letterSpacing: "0.08em",
            color: "var(--faint)",
          }}
        >
          {max}
        </span>

        <div className="chart-bars" role="img" aria-label={`${unit} per day`}>
          {buckets.map((b, i) => (
            <div
              key={i}
              className="viz-slot"
              style={{
                position: "relative",
                flex: 1,
                minWidth: 0,
                height: "100%",
                display: "flex",
                alignItems: "flex-end",
                padding: "0 1px",
              }}
            >
              <div
                className={`chart-bar${b.count === 0 ? " is-empty" : ""}`}
                style={{
                  width: "100%",
                  height: `${Math.max(3, (b.count / max) * 100)}%`,
                  background:
                    b.count === 0
                      ? undefined
                      : `linear-gradient(180deg, ${accent}, transparent 175%)`,
                }}
              />
              <span className="viz-tip" style={{ left: "50%", top: -8 }}>
                {b.count} {unit}
                <span className="t-label">{b.label}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="chart-x">
        <span>{buckets[0]?.label}</span>
        <span>{buckets[buckets.length - 1]?.label}</span>
      </div>
    </div>
  );
}

export type DonutSegment = { label: string; count: number; color: string };

/**
 * Status donut: SVG ring with 2px surface gaps between segments, hero
 * count in the center, HTML legend carrying identity + counts (so
 * identity is never color-alone).
 */
export function DonutChart({
  segments,
  centerLabel,
  emptyText = "No data yet",
}: {
  segments: DonutSegment[];
  centerLabel: string;
  emptyText?: string;
}) {
  const active = segments.filter((s) => s.count > 0);
  const total = active.reduce((sum, s) => sum + s.count, 0);

  if (total === 0) {
    return <p className="empty-state">{emptyText}</p>;
  }

  const R = 15.9155; // circumference ≈ 100 for easy percentages
  const C = 2 * Math.PI * R;
  const gap = active.length > 1 ? 2 : 0; // 2-unit surface gap between segments
  let offset = 25; // start at 12 o'clock

  const arcs = active.map((s) => {
    const len = (s.count / total) * C - gap;
    const arc = {
      color: s.color,
      dasharray: `${Math.max(0.5, len)} ${C - Math.max(0.5, len)}`,
      dashoffset: offset,
    };
    offset -= (s.count / total) * C;
    return arc;
  });

  return (
    <div className="donut-wrap">
      <svg
        viewBox="0 0 42 42"
        width="132"
        height="132"
        role="img"
        aria-label={`${centerLabel}: ${total}`}
      >
        <circle
          cx="21"
          cy="21"
          r={R}
          fill="none"
          stroke="rgba(255,255,255,0.05)"
          strokeWidth="4.5"
        />
        {arcs.map((a, i) => (
          <circle
            key={i}
            cx="21"
            cy="21"
            r={R}
            fill="none"
            stroke={a.color}
            strokeWidth="4.5"
            strokeLinecap="round"
            strokeDasharray={a.dasharray}
            strokeDashoffset={a.dashoffset}
          />
        ))}
        <text x="21" y="21.5" textAnchor="middle" className="donut-center-value" fontSize="8.5">
          {total.toLocaleString()}
        </text>
        <text x="21" y="27" textAnchor="middle" className="donut-center-label" fontSize="2.6">
          {centerLabel}
        </text>
      </svg>

      <ul className="donut-legend">
        {segments.map((s) => (
          <li key={s.label}>
            <span className="swatch" style={{ background: s.color }} />
            {s.label}
            <span className="count">{s.count.toLocaleString()}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
