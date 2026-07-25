import type { Metadata } from "next";
import { LayoutDashboard, FilePlus2, Users, Settings } from "lucide-react";
import { requireTradesAccount } from "@/lib/trades/data";
import { AppShell } from "@/components/shell/app-shell";
import type { NavSection } from "@/components/shell/types";

export const metadata: Metadata = {
  title: "AutomateIQ Trades",
  robots: { index: false, follow: false },
};

export default async function TradesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Auth + account bootstrap. Every Server Action re-checks ownership itself;
  // this is the UX gate (redirects to /trades/login when signed out).
  const { account, email } = await requireTradesAccount();
  const name = account.business_name || email || "Your business";

  const sections: NavSection[] = [
    {
      items: [
        { href: "/trades", label: "Dashboard", icon: <LayoutDashboard /> },
        { href: "/trades/new", label: "New quote", icon: <FilePlus2 /> },
        { href: "/trades/customers", label: "Customers", icon: <Users /> },
        { href: "/trades/settings", label: "Settings", icon: <Settings /> },
      ],
    },
  ];

  return (
    <AppShell
      brandLabel="AutomateIQ Trades"
      topbarTitle="Trades"
      userLabel={name}
      userInitial={name.charAt(0).toUpperCase()}
      sections={sections}
      signInHref="/trades/login"
    >
      {children}
    </AppShell>
  );
}
