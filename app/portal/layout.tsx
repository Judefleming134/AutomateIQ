import { requireSession } from "@/lib/auth/require-session";

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Redirects to /login (no session) or /admin (admin account) as needed.
  await requireSession();

  return <div className="portal-shell">{children}</div>;
}
