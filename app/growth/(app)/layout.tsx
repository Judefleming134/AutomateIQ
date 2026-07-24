import type { Metadata } from "next";
import {
  LayoutDashboard,
  Users,
  Megaphone,
  Inbox,
  CalendarClock,
  BarChart3,
  Bot,
  Settings,
  Send,
  Phone,
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

  // Same pages, same labels — just grouped and ordered around the daily
  // path (Jarvis first, then work the leads), so the everyday items sit at
  // the top. Nothing removed or renamed.
  const sections: NavSection[] = [
    {
      label: "Every day",
      items: [
        { href: "/growth/jarvis", label: "Jarvis", icon: <Bot /> },
        { href: "/growth", label: "Dashboard", icon: <LayoutDashboard /> },
        { href: "/growth/prospects", label: "Prospects", icon: <Users /> },
        { href: "/growth/call-list", label: "Call list", icon: <Phone /> },
        { href: "/growth/dms", label: "DM list", icon: <Send /> },
        { href: "/growth/inbox", label: "Inbox", icon: <Inbox /> },
      ],
    },
    {
      label: "Pipeline",
      items: [
        { href: "/growth/campaigns", label: "Campaigns", icon: <Megaphone /> },
        { href: "/growth/meetings", label: "Meetings", icon: <CalendarClock /> },
      ],
    },
    {
      label: "Insight & setup",
      items: [
        { href: "/growth/analytics", label: "Analytics", icon: <BarChart3 /> },
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
      <p
        style={{
          marginTop: 32,
          paddingTop: 16,
          borderTop: "1px solid var(--line, rgba(255,255,255,.08))",
          fontSize: 12,
          color: "var(--faint)",
          textAlign: "center",
        }}
      >
        Need help with anything? Contact us at{" "}
        <a href="mailto:hello@automateiq.ie">hello@automateiq.ie</a>
      </p>
    </AppShell>
  );
}
