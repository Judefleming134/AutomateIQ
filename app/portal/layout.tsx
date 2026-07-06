import {
  LayoutDashboard,
  BarChart3,
  Users,
  CreditCard,
  Settings,
  Sparkles,
  Boxes,
  FolderKanban,
  BookOpen,
  Layers,
} from "lucide-react";
import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/shell/app-shell";
import type { NavSection } from "@/components/shell/types";

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Redirects to /login (no session) or /admin (admin account) as needed.
  const { user, profile } = await requireSession();
  const supabase = await createClient();

  const [{ data: business }, { data: enabledRows }] = await Promise.all([
    supabase
      .from("businesses")
      .select("name")
      .eq("id", profile.business_id)
      .single(),
    // RLS already scopes this to the caller's own business.
    supabase.from("business_products").select("products(key)"),
  ]);

  const enabledKeys = new Set(
    (enabledRows ?? [])
      .map((r) => (r.products as unknown as { key: string } | null)?.key)
      .filter((k): k is string => Boolean(k))
  );

  const businessName = business?.name ?? "Your business";

  // V2 navigation: one clean set of destinations. Individual products live
  // inside the Products hub (and are driven by the agent registry), so
  // future agents never add sidebar entries.
  const sections: NavSection[] = [
    {
      label: "Workspace",
      items: [
        { href: "/portal", label: "Dashboard", icon: <LayoutDashboard /> },
        {
          href: "/portal/ai-assistant",
          label: "AI Assistant",
          icon: <Sparkles />,
          disabled: !enabledKeys.has("ai-assistant"),
        },
        { href: "/portal/products", label: "Products", icon: <Boxes /> },
        { href: "/portal/solutions", label: "Solutions", icon: <Layers /> },
        { href: "/portal/analytics", label: "Analytics", icon: <BarChart3 /> },
        { href: "/portal/projects", label: "Projects", icon: <FolderKanban /> },
        { href: "/portal/documentation", label: "Documentation", icon: <BookOpen /> },
      ],
    },
    {
      label: "Account",
      items: [
        { href: "/portal/team", label: "Team", icon: <Users /> },
        { href: "/portal/billing", label: "Billing", icon: <CreditCard /> },
        { href: "/portal/settings", label: "Settings", icon: <Settings /> },
      ],
    },
  ];

  return (
    <AppShell
      brandLabel="AutomateIQ"
      topbarTitle={businessName}
      userLabel={user.email ?? ""}
      userInitial={businessName.charAt(0).toUpperCase()}
      sections={sections}
    >
      {children}
    </AppShell>
  );
}
