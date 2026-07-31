import type { Metadata } from "next";
import { LayoutDashboard, FilePlus2, ScanLine, Wallet, Users, Settings, Sparkles } from "lucide-react";
import { requireTradesAccount } from "@/lib/trades/data";
import { AppShell } from "@/components/shell/app-shell";
import type { NavSection } from "@/components/shell/types";

export const metadata: Metadata = {
  title: "TradeIQ",
  robots: { index: false, follow: false },
};

export default async function TradesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Auth + account bootstrap. Every Server Action re-checks ownership itself;
  // this is the UX gate (redirects to /tradeiq/login when signed out).
  const { account, email } = await requireTradesAccount();
  const name = account.business_name || email || "Your business";

  const sections: NavSection[] = [
    {
      items: [
        { href: "/tradeiq", label: "Dashboard", icon: <LayoutDashboard /> },
        { href: "/tradeiq/assistant", label: "Assistant", icon: <Sparkles /> },
        { href: "/tradeiq/new", label: "New quote", icon: <FilePlus2 /> },
        { href: "/tradeiq/scan", label: "Scan an invoice", icon: <ScanLine /> },
        { href: "/tradeiq/finance", label: "Finance", icon: <Wallet /> },
        { href: "/tradeiq/customers", label: "Customers", icon: <Users /> },
        { href: "/tradeiq/settings", label: "Settings", icon: <Settings /> },
      ],
    },
  ];

  return (
    <AppShell
      brandLabel="TradeIQ"
      topbarTitle="TradeIQ"
      userLabel={name}
      userInitial={name.charAt(0).toUpperCase()}
      sections={sections}
      signInHref="/tradeiq/login"
    >
      {children}
    </AppShell>
  );
}
