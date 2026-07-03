import { requireAdmin } from "@/lib/auth/require-admin";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Redirects to /login (no session) or /portal (non-admin account).
  // Every admin Server Action/Route Handler re-checks this independently —
  // this layout is a UX convenience, not the actual security boundary.
  await requireAdmin();

  return <div className="admin-shell">{children}</div>;
}
