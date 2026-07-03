import { LayoutDashboard } from "lucide-react";
import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";
import { PRODUCT_REGISTRY } from "@/lib/products/registry";
import { ProductIcon } from "@/lib/products/icons";
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

  const sections: NavSection[] = [
    {
      items: [
        {
          href: "/portal",
          label: "Dashboard",
          icon: <LayoutDashboard />,
        },
      ],
    },
    {
      label: "Products",
      items: PRODUCT_REGISTRY.map((product) => ({
        href: product.href,
        label: product.name,
        icon: <ProductIcon name={product.iconName} />,
        disabled: !enabledKeys.has(product.key),
      })),
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
