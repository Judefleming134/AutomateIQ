const STATUS_META: Record<string, { label: string; className: string }> = {
  pending: { label: "Pending", className: "badge-gray" },
  sent: { label: "Sent", className: "badge-blue" },
  reminded: { label: "Reminder sent", className: "badge-orange" },
  clicked: { label: "Clicked", className: "badge-green" },
  failed: { label: "Failed", className: "badge-red" },
};

export function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? { label: status, className: "badge-gray" };
  return <span className={`badge ${meta.className}`}>{meta.label}</span>;
}
