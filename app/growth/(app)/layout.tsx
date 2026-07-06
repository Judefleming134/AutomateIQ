import type { Metadata } from "next";
import {
  LayoutDashboard,
  Users,
  Megaphone,
  Inbox,
  CalendarClock,
  BarChart3,
  FileText,
  Settings,
} from "lucide-react";
import { requireGrowth } from "@/lib/growth/auth";
import { AppShell } from "@/components/shell/app-shell";
import type { NavSection } from "@/components/shell/types";

export const metadata: Metadata = {
  title: "AutomateIQ Growth Engine",
  robots: { index: false, follow: false },
};

export default async function GrowthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // UX routing only — every Growth server action / route handler re-checks
  // membership itself via requireGrowth() (same doctrine as /admin).
  const { member } = await requireGrowth();

  const sections: NavSection[] = [
    {
      items: [
        { href: "/growth", label: "Dashboard", icon: <LayoutDashboard /> },
        { href: "/growth/prospects", label: "Prospects", icon: <Users /> },
        { href: "/growth/campaigns", label: "Campaigns", icon: <Megaphone /> },
        { href: "/growth/inbox", label: "Inbox", icon: <Inbox /> },
        { href: "/growth/meetings", label: "Meetings", icon: <CalendarClock /> },
      ],
    },
    {
      label: "Insight",
      items: [
        { href: "/growth/analytics", label: "Analytics", icon: <BarChart3 /> },
        { href: "/growth/reports", label: "Reports", icon: <FileText /> },
      ],
    },
    {
      label: "Workspace",
      items: [
        { href: "/growth/settings", label: "Settings", icon: <Settings /> },
      ],
    },
  ];

  return (
    <AppShell
      brandLabel="AutomateIQ Growth"
      topbarTitle="Growth Engine"
      userLabel={member.name || member.email}
      userInitial={(member.name || member.email).charAt(0).toUpperCase()}
      sections={sections}
      signInHref="/growth/login"
    >
      {children}
    </AppShell>
  );
}
