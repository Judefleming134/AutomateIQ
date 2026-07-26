import type { Metadata } from "next";
import { LayoutDashboard, FilePlus2, ScanLine, Wallet, Users, Settings, Sparkles } from "lucide-react";
import { requireTradesAccount } from "@/lib/trades/data";
import { AppShell } from "@/components/shell/app-shell";
import type { NavSection } from "@/components/shell/types";

export const metadata: Metadata = {
  title: "TradeOS",
  robots: { index: false, follow: false },
};

export default async function TradesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Auth + account bootstrap. Every Server Action re-checks ownership itself;
  // this is the UX gate (redirects to /tradeos/login when signed out).
  const { account, email } = await requireTradesAccount();
  const name = account.business_name || email || "Your business";

  const sections: NavSection[] = [
    {
      items: [
        { href: "/tradeos", label: "Dashboard", icon: <LayoutDashboard /> },
        { href: "/tradeos/assistant", label: "Assistant", icon: <Sparkles /> },
        { href: "/tradeos/new", label: "New quote", icon: <FilePlus2 /> },
        { href: "/tradeos/scan", label: "Scan an invoice", icon: <ScanLine /> },
        { href: "/tradeos/finance", label: "Finance", icon: <Wallet /> },
        { href: "/tradeos/customers", label: "Customers", icon: <Users /> },
        { href: "/tradeos/settings", label: "Settings", icon: <Settings /> },
      ],
    },
  ];

  return (
    <AppShell
      brandLabel="TradeOS"
      topbarTitle="TradeOS"
      userLabel={name}
      userInitial={name.charAt(0).toUpperCase()}
      sections={sections}
      signInHref="/tradeos/login"
    >
      {children}
    </AppShell>
  );
}
