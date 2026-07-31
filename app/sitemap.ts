import type { MetadataRoute } from "next";
import { MARKETING_PRODUCTS } from "@/lib/products/marketing";

const SITE = "https://automateiq.ie";

/**
 * Served at /sitemap.xml. Lists the public, indexable pages: the marketing
 * home, the systems overview, the AI Strategy Session booking page, the free
 * tools and the legal pages. The authenticated app is intentionally excluded.
 *
 * /agents.html was removed 2026-07-31: it was a 50KB static page nothing linked
 * to, describing the product range from before the vertical structure existed
 * (so it could never mention PermitIQ). /systems covers the same ground, lives
 * in the app, and updates with the product. The old URL 308s to it.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${SITE}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE}/book`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    // The product pages. These are the URLs said out loud on a call, and until
    // they existed the answer to "where do I see TradeIQ?" was a login box.
    { url: `${SITE}/products`, lastModified: now, changeFrequency: "monthly", priority: 0.9 },
    ...MARKETING_PRODUCTS.map((p) => ({
      url: `${SITE}/products/${p.slug}`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.9,
    })),
    { url: `${SITE}/systems`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE}/savings`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    // The free tools are front doors: people search for these problems in the
    // exact words the pages answer them in, so they earn a high priority. The
    // embed route is deliberately absent — it renders inside customers' own
    // sites and must never compete with them in search results.
    { url: `${SITE}/freetools`, lastModified: now, changeFrequency: "monthly", priority: 0.9 },
    { url: `${SITE}/freetools/autoseo`, lastModified: now, changeFrequency: "monthly", priority: 0.9 },
    { url: `${SITE}/freetools/google-profile`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE}/freetools/response-time`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE}/freetools/missed-calls`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE}/freetools/reviews`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE}/freetools/quote-builder`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    // The policies hub and the AI-governance statement are deliberately
    // indexable and ranked above the boilerplate legal pages: "how does this
    // company handle the EU AI Act" is a question prospects genuinely search,
    // and a straight answer is a trust asset rather than fine print.
    { url: `${SITE}/policies.html`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE}/ai-act.html`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE}/privacy.html`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE}/terms.html`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE}/cookies.html`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
  ];
}
