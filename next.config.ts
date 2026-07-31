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

      // TradeIQ. The route tree moved to /tradeiq on 2026-07-31, so the brand
      // and the URL finally agree.
      //
      // The direction of these redirects is now the reverse of what it was for
      // the day the brand led the URL. /tradeos must keep working forever, not
      // as a courtesy but because it is load-bearing: customers have it
      // bookmarked and saved in password managers, and — the one that would
      // actually cost money — every signed invoice and quote link already
      // emailed to a tradesperson's OWN customer is a /tradeos/doc/<token> URL
      // sitting in a stranger's inbox. Those must resolve years from now.
      //
      // 308 permanent, because /tradeiq is genuinely canonical now and the
      // ranking should transfer. The :path* form carries the token through.
      { source: "/tradeos", destination: "/tradeiq", permanent: true },
      { source: "/tradeos/:path*", destination: "/tradeiq/:path*", permanent: true },

      // Two static pages retired 2026-07-31, both orphaned (nothing linked to
      // either) but still publicly served to anyone holding the URL.
      //
      // demo.html was superseded by /demo, the live receptionist demo built as
      // a real route — and it was the last place on the public site still
      // showing the pre-rebrand product names.
      //
      // agents.html described the product range from before the vertical
      // structure existed, so it could never mention PermitIQ. /systems covers
      // the same ground, lives in the app, and updates with the product.
      { source: "/demo.html", destination: "/demo", permanent: true },
      { source: "/agents.html", destination: "/systems", permanent: true },
    ];
  },
};

export default nextConfig;
