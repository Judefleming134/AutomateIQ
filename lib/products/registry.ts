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

/**
 * The vertical each product belongs to.
 *
 * THIS IS A DISPLAY LAYER, AND DELIBERATELY SO. `key` above is an entitlement
 * foreign key: `business_products` joins on it and `guardProduct("review-agent")`
 * is called across the codebase, so renaming a key would silently strip the
 * product from every customer who has it. Families give the portal the
 * Salesforce-style vertical structure without touching a single key.
 *
 * "core" is the cross-vertical infrastructure every customer can use whatever
 * industry they're in; the named families are industry products.
 */
export type ProductFamily =
  | "core"
  | "tradeiq"
  | "financeiq"
  | "permitiq"
  | "reputationiq";

export type FamilyDefinition = {
  key: ProductFamily;
  label: string;
  tagline: string;
};

/** Render order of the family sections in the portal. */
export const PRODUCT_FAMILIES: FamilyDefinition[] = [
  {
    key: "core",
    label: "AutomateIQ Core",
    tagline: "The shared AI layer every product on the platform runs on.",
  },
  {
    key: "tradeiq",
    label: "TradeIQ",
    tagline: "For trades and service businesses — quoting, leads and jobs.",
  },
  {
    key: "reputationiq",
    label: "ReputationIQ",
    tagline: "Reviews and online reputation, in every industry.",
  },
  {
    key: "financeiq",
    label: "FinanceIQ",
    tagline: "Document processing, onboarding and reporting for finance teams.",
  },
  {
    key: "permitiq",
    label: "PermitIQ",
    tagline: "Planning permission and building permit workflows.",
  },
];

export type ProductDefinition = {
  key: string;
  name: string;
  description: string;
  href: string;
  iconName: string;
  accent: string; // per-product tile accent color, chrome stays brand blue
  status: ProductStatus; // mirrors products.status, drives the tile's badge
  family: ProductFamily;
};

export const PRODUCT_REGISTRY: ProductDefinition[] = [
  {
    key: "review-agent",
    name: "ReputationIQ",
    description:
      "Automate review requests and follow-ups to grow your online reputation.",
    href: "/portal/review-agent",
    iconName: "star",
    accent: "#7C3AED",
    status: "active",
    family: "reputationiq",
  },
  {
    key: "website-agent",
    name: "SiteIQ",
    description: "AI-powered websites that convert and engage.",
    href: "/portal/website-agent",
    iconName: "globe",
    accent: "#3B82F6",
    status: "active",
    family: "core",
  },
  {
    key: "ai-assistant",
    name: "AssistIQ",
    description: "A smart assistant that helps your business around the clock.",
    href: "/portal/ai-assistant",
    iconName: "bot",
    accent: "#22D3EE",
    status: "active",
    family: "core",
  },
  {
    key: "content-agent",
    name: "ContentIQ",
    description:
      "AI-written blogs, social posts, emails and ad copy — on brand, on demand.",
    href: "/portal/content-agent",
    iconName: "pen-line",
    accent: "#EC4899",
    status: "active",
    family: "core",
  },
  {
    key: "instant-quote-agent",
    name: "QuoteIQ",
    description:
      "Turns a job description into a priced, itemised quote in seconds.",
    href: "/portal/instant-quote-agent",
    iconName: "calculator",
    accent: "#EA580C",
    status: "active",
    family: "tradeiq",
  },
  {
    key: "crm-agent",
    name: "ClientIQ",
    description:
      "Every customer and lead in one place, searchable and up to date.",
    href: "/portal/crm-agent",
    iconName: "contact",
    accent: "#3B82F6",
    status: "active",
    family: "tradeiq",
  },
  {
    key: "speed-to-lead-agent",
    name: "LeadIQ",
    description:
      "Replies to every new lead in under 60 seconds, day or night.",
    href: "/portal/speed-to-lead-agent",
    iconName: "zap",
    accent: "#F59E0B",
    status: "active",
    family: "tradeiq",
  },
  {
    key: "permitiq",
    name: "PermitIQ",
    description:
      "Planning permission and building permits — upload the documents, get a checklist, a summary and the gaps before you submit.",
    href: "/portal/permitiq",
    iconName: "file-check",
    accent: "#0EA5E9",
    status: "active",
    family: "permitiq",
  },
  {
    key: "custom-solutions",
    name: "CustomIQ",
    description: "Bespoke AI modules built specifically for your business.",
    href: "/portal/custom-solutions",
    iconName: "box",
    accent: "#F472B6",
    status: "framework",
    family: "core",
  },
];

export function getProductByKey(key: string) {
  return PRODUCT_REGISTRY.find((p) => p.key === key);
}

/**
 * The registry grouped for rendering, in family order, with empty families
 * dropped. A family with no products yet (FinanceIQ today) simply doesn't
 * appear — no placeholder section, no "coming soon" shell to maintain.
 *
 * Products are returned in their registry order within each family, so the
 * existing hand-tuned ordering is preserved rather than re-sorted.
 */
export function productsByFamily(): {
  family: FamilyDefinition;
  products: ProductDefinition[];
}[] {
  return PRODUCT_FAMILIES.map((family) => ({
    family,
    products: PRODUCT_REGISTRY.filter((p) => p.family === family.key),
  })).filter((group) => group.products.length > 0);
}
