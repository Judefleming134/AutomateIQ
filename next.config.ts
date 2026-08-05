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

      // Two of the three product names had no URL of their own, in ANY
      // casing. TradeIQ has a real route at /tradeiq, so /tradeiq and (via
      // the proxy's case correction) /TradeIQ both land. PermitIQ and
      // FinanceIQ don't: they live at /portal/permitiq and /finance, so
      // /permitiq and /financeiq — the names actually said out loud and
      // printed on a card — were plain 404s.
      //
      // They point at the public product pages rather than the apps, because
      // that's the right landing for someone who typed a brand name: the page
      // explains what it is AND carries the Log in button for a customer who
      // already has an account.
      { source: "/permitiq", destination: "/products/permitiq", permanent: true },
      { source: "/financeiq", destination: "/products/financeiq", permanent: true },

      // …and then the same hole was still open for everything else.
      //
      // /permitiq and /financeiq fixed two names and stopped. Every other
      // product was in exactly the same state: SiteIQ answered at
      // /portal/website-agent, AssistIQ at /portal/ai-assistant, QuoteIQ at
      // /portal/instant-quote-agent — old internal slugs, behind a login, and
      // unguessable. The brand is the thing said out loud; the brand is what
      // gets typed into the address bar. So every product now has its own
      // top-level address, and the rule has no exceptions left to forget.
      //
      // They land on the public product page rather than the app for the same
      // reason the first two did: a stranger who typed the name gets an
      // explanation, and a customer who typed it gets the Log in button that
      // page already carries.
      //
      // TradeIQ is deliberately absent — /tradeiq is a real route (the app
      // itself), and /tradeos/:path* above redirects INTO it. A redirect here
      // would break the app root and every emailed invoice link with it.
      { source: "/quoteiq", destination: "/products/quoteiq", permanent: true },
      { source: "/clientiq", destination: "/products/clientiq", permanent: true },
      { source: "/leadiq", destination: "/products/leadiq", permanent: true },
      { source: "/customiq", destination: "/products/customiq", permanent: true },
      { source: "/siteiq", destination: "/products/siteiq", permanent: true },
      { source: "/contentiq", destination: "/products/contentiq", permanent: true },
      { source: "/assistiq", destination: "/products/assistiq", permanent: true },
      { source: "/reputationiq", destination: "/products/reputationiq", permanent: true },

      // The brand casing, as it is actually written down.
      //
      // Nobody writes "quoteiq" — the name is QuoteIQ, and that is what goes on
      // a card, in an email signature and into an address bar. Next matches a
      // redirect `source` CASE-SENSITIVELY and there is no middleware here, so
      // /quoteIQ was a 404 while /quoteiq worked. The line above about "the
      // proxy's case correction" was assuming something this codebase does not
      // do; these entries make it true rather than hoped for.
      //
      // One extra line per product, matching the one casing a human types. It
      // is deliberately not a middleware: a middleware would run on requests
      // across the whole site to fix eleven URLs.
      { source: "/tradeIQ", destination: "/tradeiq", permanent: true },
      { source: "/financeIQ", destination: "/products/financeiq", permanent: true },
      { source: "/permitIQ", destination: "/products/permitiq", permanent: true },
      { source: "/quoteIQ", destination: "/products/quoteiq", permanent: true },
      { source: "/clientIQ", destination: "/products/clientiq", permanent: true },
      { source: "/leadIQ", destination: "/products/leadiq", permanent: true },
      { source: "/customIQ", destination: "/products/customiq", permanent: true },
      { source: "/siteIQ", destination: "/products/siteiq", permanent: true },
      { source: "/contentIQ", destination: "/products/contentiq", permanent: true },
      { source: "/assistIQ", destination: "/products/assistiq", permanent: true },
      { source: "/reputationIQ", destination: "/products/reputationiq", permanent: true },
    ];
  },
};

export default nextConfig;
