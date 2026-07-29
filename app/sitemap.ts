import type { MetadataRoute } from "next";

const SITE = "https://automateiq.ie";

/**
 * Served at /sitemap.xml. Lists the public, indexable pages: the marketing
 * home, the agents overview, the AI Strategy Session booking page and the
 * legal pages. The authenticated app is intentionally excluded.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${SITE}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE}/book`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${SITE}/systems`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE}/savings`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE}/agents.html`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
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
