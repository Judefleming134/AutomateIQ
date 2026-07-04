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
  status: ProductStatus; // mirrors products.status, drives the tile's badge
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
    status: "active",
  },
  {
    key: "website-agent",
    name: "Website Agent",
    description: "AI-powered websites that convert and engage.",
    href: "/portal/website-agent",
    iconName: "globe",
    accent: "#3B82F6",
    status: "active",
  },
  {
    key: "ai-assistant",
    name: "AI Assistant",
    description: "A smart assistant that helps your business around the clock.",
    href: "/portal/ai-assistant",
    iconName: "bot",
    accent: "#22D3EE",
    status: "active",
  },
  {
    key: "content-agent",
    name: "Content Agent",
    description:
      "AI-written blogs, social posts, emails and ad copy — on brand, on demand.",
    href: "/portal/content-agent",
    iconName: "pen-line",
    accent: "#EC4899",
    status: "active",
  },
  {
    key: "instant-quote-agent",
    name: "Instant Quote Agent",
    description:
      "Turns a job description into a priced, itemised quote in seconds.",
    href: "/portal/instant-quote-agent",
    iconName: "calculator",
    accent: "#EA580C",
    status: "active",
  },
  {
    key: "crm-agent",
    name: "CRM Agent",
    description:
      "Every customer and lead in one place, searchable and up to date.",
    href: "/portal/crm-agent",
    iconName: "contact",
    accent: "#3B82F6",
    status: "active",
  },
  {
    key: "speed-to-lead-agent",
    name: "Speed-to-Lead Agent",
    description:
      "Replies to every new lead in under 60 seconds, day or night.",
    href: "/portal/speed-to-lead-agent",
    iconName: "zap",
    accent: "#F59E0B",
    status: "active",
  },
  {
    key: "custom-solutions",
    name: "Custom Solutions",
    description: "Bespoke AI modules built specifically for your business.",
    href: "/portal/custom-solutions",
    iconName: "box",
    accent: "#F472B6",
    status: "framework",
  },
];

export function getProductByKey(key: string) {
  return PRODUCT_REGISTRY.find((p) => p.key === key);
}
