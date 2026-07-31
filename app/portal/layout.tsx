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
import { requireTenant } from "@/lib/auth/require-tenant";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/shell/app-shell";
import type { NavSection } from "@/components/shell/types";

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Redirects to /login (no session), /admin (admin account), or
  // /account-unavailable (suspended or soft-deleted tenant).
  //
  // This used to be requireSession() plus a businesses lookup right here. The
  // lookup ran through the RLS-scoped client, and the RLS helper requires
  // status='active' AND deleted_at IS NULL — so for a suspended customer the
  // row came back null, businessName fell through to the placeholder "Your
  // business", and the whole portal rendered with every panel empty because
  // the same predicate hid their data too. It looked exactly like their
  // account had been wiped. requireTenant does the same query and turns that
  // null into an honest page instead of a hollow portal.
  const { user, profile, business } = await requireTenant();
  const supabase = await createClient();

  // RLS already scopes this to the caller's own business.
  const { data: enabledRows } = await supabase
    .from("business_products")
    .select("products(key)");

  const enabledKeys = new Set(
    (enabledRows ?? [])
      .map((r) => (r.products as unknown as { key: string } | null)?.key)
      .filter((k): k is string => Boolean(k))
  );

  // requireTenant guarantees an active business, so the placeholder fallback
  // that used to hide the suspended case is no longer needed.
  const businessName = business.name;

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
