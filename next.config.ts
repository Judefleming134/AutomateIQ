import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Document uploads (contracts/paperwork) go through a Server Action;
      // the default 1MB body limit is too small for scanned PDFs.
      bodySizeLimit: "15mb",
    },
  },
  /**
   * The free tools moved to /freetools so a customer can see everything on
   * offer in one place before buying an agent. Permanent (308) redirects
   * because the old URLs shipped publicly and are already in the sitemap —
   * anything linked, bookmarked or indexed has to keep working, and a
   * permanent redirect passes the ranking on rather than starting over.
   *
   * The response-time test is the reason this matters most: an email sent
   * before the move carries an old /tools result link, and a dead link there
   * means someone never sees their number.
   */
  async redirects() {
    return [
      { source: "/autoseo", destination: "/freetools/autoseo", permanent: true },
      { source: "/tools", destination: "/freetools", permanent: true },
      { source: "/tools/:path*", destination: "/freetools/:path*", permanent: true },

      // TradeOS is now TradeIQ. The BRAND changed; the route did not, and that
      // is deliberate — /tradeos is a signed-in product with live customers,
      // whose bookmarks, saved passwords and emailed document links all point
      // at it. Moving the route tree to earn a tidier URL would risk all of
      // that for cosmetics.
      //
      // So /tradeiq works from today (marketing, business cards, "log in at
      // automateiq.ie/tradeiq") and lands on the same app. TEMPORARY (307), not
      // permanent: /tradeos is still canonical, and a 308 here would have
      // browsers cache /tradeiq → /tradeos forever, which is exactly backwards
      // if the route tree ever does move to /tradeiq.
      { source: "/tradeiq", destination: "/tradeos", permanent: false },
      { source: "/tradeiq/:path*", destination: "/tradeos/:path*", permanent: false },
    ];
  },
};

export default nextConfig;
