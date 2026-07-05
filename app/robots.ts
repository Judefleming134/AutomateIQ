import type { MetadataRoute } from "next";

const SITE = "https://automateiq.ie";

/**
 * Served at /robots.txt. Allows the public marketing/booking surfaces and
 * keeps crawlers out of the authenticated app + API.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/portal", "/admin", "/api", "/login", "/setup", "/auth"],
    },
    sitemap: `${SITE}/sitemap.xml`,
    host: SITE,
  };
}
