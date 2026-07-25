import type { Metadata } from "next";
import { LayoutDashboard, ScanLine, Hammer, Settings } from "lucide-react";
import { requireTradesAccount } from "@/lib/trades/data";
import { AppShell } from "@/components/shell/app-shell";
import type { NavSection } from "@/components/shell/types";

export const metadata: Metadata = {
  title: "AutomateIQ Finance",
  robots: { index: false, follow: false },
};

export default async function FinanceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Same account system as TradeOS — a TradeOS customer signing in here is
  // linked automatically. Unauthenticated visitors land on Finance's own
  // login (with the "Already a TradeOS customer?" path), not TradeOS's.
  const { account, email } = await requireTradesAccount("/finance/login");
  const name = account.business_name || email || "Your business";

  const sections: NavSection[] = [
    {
      items: [
        { href: "/finance", label: "Dashboard", icon: <LayoutDashboard /> },
        { href: "/finance/scan", label: "Scan an invoice", icon: <ScanLine /> },
        { href: "/finance/settings", label: "Settings", icon: <Settings /> },
      ],
    },
    {
      label: "More",
      items: [
        // The cross-door: quotes & invoicing live in TradeOS, same account.
        { href: "/tradeos", label: "TradeOS", icon: <Hammer /> },
      ],
    },
  ];

  return (
    <AppShell
      brandLabel="AutomateIQ Finance"
      topbarTitle="Finance"
      userLabel={name}
      userInitial={name.charAt(0).toUpperCase()}
      sections={sections}
      signInHref="/finance/login"
    >
      {children}
    </AppShell>
  );
}
