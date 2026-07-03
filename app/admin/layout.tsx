import { LayoutDashboard, Users } from "lucide-react";
import { requireAdmin } from "@/lib/auth/require-admin";
import { AppShell } from "@/components/shell/app-shell";
import type { NavSection } from "@/components/shell/types";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Redirects to /login (no session) or /portal (non-admin account).
  // Every admin Server Action/Route Handler re-checks this independently —
  // this layout is a UX convenience, not the actual security boundary.
  const user = await requireAdmin();

  const sections: NavSection[] = [
    {
      items: [
        { href: "/admin", label: "Dashboard", icon: <LayoutDashboard /> },
        { href: "/admin/customers", label: "Customers", icon: <Users /> },
      ],
    },
  ];

  return (
    <AppShell
      brandLabel="AutomateIQ Admin"
      topbarTitle="Platform Admin"
      userLabel={user.email ?? ""}
      userInitial={(user.email ?? "A").charAt(0).toUpperCase()}
      sections={sections}
    >
      {children}
    </AppShell>
  );
}
