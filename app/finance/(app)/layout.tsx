import type { Metadata } from "next";
import {
  LayoutDashboard,
  ScanLine,
  CalendarRange,
  HandCoins,
  PiggyBank,
  BarChart3,
  Landmark,
  Newspaper,
  Hammer,
  Sparkles,
  Settings,
} from "lucide-react";
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
  // Same account system as TradeIQ — a TradeIQ customer signing in here is
  // linked automatically. Unauthenticated visitors land on Finance's own
  // login (with the "Already a TradeIQ customer?" path), not TradeIQ's.
  const { account, email } = await requireTradesAccount("/finance/login");
  const name = account.business_name || email || "Your business";

  const sections: NavSection[] = [
    {
      items: [
        { href: "/finance", label: "Dashboard", icon: <LayoutDashboard /> },
        { href: "/finance/scan", label: "Scan an invoice", icon: <ScanLine /> },
        { href: "/finance/forecast", label: "Cash-flow forecast", icon: <CalendarRange /> },
        { href: "/finance/receivables", label: "Who owes you", icon: <HandCoins /> },
        { href: "/finance/budgets", label: "Budgets", icon: <PiggyBank /> },
        { href: "/finance/reports", label: "Reports", icon: <BarChart3 /> },
        { href: "/finance/bank", label: "Bank & feeds", icon: <Landmark /> },
        { href: "/finance/news", label: "News", icon: <Newspaper /> },
        { href: "/finance/settings", label: "Settings", icon: <Settings /> },
      ],
    },
    {
      label: "More",
      items: [
        // The cross-door: quotes & invoicing live in TradeIQ, same account.
        { href: "/tradeos", label: "TradeIQ", icon: <Hammer /> },
        { href: "/tradeos/assistant", label: "Assistant", icon: <Sparkles /> },
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
