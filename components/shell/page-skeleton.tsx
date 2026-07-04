/**
 * Route-level loading skeleton — mirrors the standard page anatomy
 * (hero, stat cards, two panels) so navigation feels instant while the
 * server component streams in.
 */
export function PageSkeleton() {
  return (
    <div className="skeleton-page" aria-busy="true" aria-label="Loading">
      <div className="skeleton skeleton-hero" />
      <div className="skeleton-stats">
        <div className="skeleton skeleton-stat" />
        <div className="skeleton skeleton-stat" />
        <div className="skeleton skeleton-stat" />
        <div className="skeleton skeleton-stat" />
      </div>
      <div className="skeleton-panels">
        <div className="skeleton skeleton-panel" />
        <div className="skeleton skeleton-panel" />
      </div>
    </div>
  );
}
