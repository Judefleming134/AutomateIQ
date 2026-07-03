/**
 * Code-side product registry. Mirrors the `products` table (seeded in
 * supabase/seed.sql) — this is deliberate duplication, not a bug: the DB
 * row controls entitlement (business_products) and is the source of truth
 * for "does this product exist," while this registry controls how the
 * portal shell renders it (route, icon, tile copy). Adding module #11
 * later means one new row in seed.sql/a migration, one new route segment,
 * and one new entry here — never a change to the shell itself.
 */
export type ProductStatus = "active" | "coming_soon" | "framework";

export type ProductDefinition = {
  key: string;
  name: string;
  description: string;
  href: string;
  iconName: string;
  accent: string; // per-product tile accent color, chrome stays brand blue
};

export const PRODUCT_REGISTRY: ProductDefinition[] = [
  {
    key: "review-agent",
    name: "Review Agent",
    description:
      "Automate review requests and follow-ups to grow your online reputation.",
    href: "/portal/review-agent",
    iconName: "star",
    accent: "#7C3AED",
  },
  {
    key: "website-agent",
    name: "Website Agent",
    description: "AI-powered websites that convert and engage.",
    href: "/portal/website-agent",
    iconName: "globe",
    accent: "#3B82F6",
  },
  {
    key: "ai-assistant",
    name: "AI Assistant",
    description: "A smart assistant that helps your business around the clock.",
    href: "/portal/ai-assistant",
    iconName: "bot",
    accent: "#22D3EE",
  },
  {
    key: "custom-solutions",
    name: "Custom Solutions",
    description: "Bespoke AI modules built specifically for your business.",
    href: "/portal/custom-solutions",
    iconName: "box",
    accent: "#F472B6",
  },
];

export function getProductByKey(key: string) {
  return PRODUCT_REGISTRY.find((p) => p.key === key);
}
