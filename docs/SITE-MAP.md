# Every URL on automateiq.ie — stay / go / rename

Generated 2026-07-31 from the route tree, `public/`, `next.config.ts` redirects
and `app/sitemap.ts`.

**100 page routes + 8 static HTML files.** This lists what exists and flags what
looks wrong. I enumerated every route and checked linkage, the sitemap and
branding; I did **not** read the content of all 100 pages, so "keep" below means
"nothing structurally wrong with it", not "I've reviewed the copy".

**Recommendation legend:** ✅ keep · ✏️ rename/fix · ❓ your call · 🗑️ candidate to remove

---

## 1. Public and indexed — the pages that earn customers

These are in `sitemap.xml`, so Google is told about them.

| URL | What it is | |
|---|---|---|
| `/` | Marketing home — **`public/index.html`, 137KB static** | ✅ |
| `/book` | AI Strategy Session booking | ✅ |
| `/systems` | Systems overview | ✅ |
| `/savings` | Savings calculator | ✅ |
| `/freetools` | Free tools hub | ✅ |
| `/freetools/autoseo` | SEO auditor | ✅ |
| `/freetools/google-profile` | Google Business Profile checker | ✅ *(needs J1 key)* |
| `/freetools/response-time` | Response-time test | ✅ *(needs J2)* |
| `/freetools/missed-calls` | Missed-call calculator | ✅ |
| `/freetools/reviews` | Review writer | ✅ |
| `/freetools/quote-builder` | Quote builder | ✅ |
| `/agents.html` | **50KB static agent catalog** | ❓ see §6 |
| `/policies.html` | Policy hub | ✅ |
| `/ai-act.html` | EU AI Act statement | ✅ |
| `/privacy.html` · `/terms.html` · `/cookies.html` | Legal | ✅ |

**There is no `app/page.tsx`.** The homepage is a static 137KB HTML file. That's
a deliberate-looking choice and it works, but it means the front page is the one
surface the Next app, the design system and the rebrand tooling cannot reach.

---

## 2. Public but deliberately NOT indexed — utility routes

Correctly absent from the sitemap. All keep.

| URL | Purpose |
|---|---|
| `/demo` | Live AI receptionist demo for sales calls — `robots: noindex` on purpose |
| `/b/[slug]` | Customer-built website pages (SiteIQ) |
| `/q/[token]` | Signed quote view for a tradesperson's customer |
| `/tradeos/doc/[token]` | Signed invoice/quote view |
| `/embed/quote` | Quote widget embedded in customers' own sites |
| `/leaving` | Outbound review-link interstitial |
| `/account-unavailable` | Suspended/inactive tenant page |
| `/login` · `/auth/set-password` | Auth |
| `/setup` | First-run admin bootstrap |

---

## 3. Authenticated — customer portal

`/portal/*` — 30 routes. Product routes still carry their **original slugs**,
and that is deliberate: `products.key` is the entitlement foreign key that
`business_products` joins on, and the URLs are in customers' bookmarks and
emails. Branding lives above the URL.

| URL | Shown as | |
|---|---|---|
| `/portal` | Dashboard | ✅ |
| `/portal/ai-assistant` | **AssistIQ** | ✅ slug kept on purpose |
| `/portal/review-agent` *(+ 4 sub-pages)* | **ReputationIQ** | ✅ |
| `/portal/website-agent` *(+ leads)* | **SiteIQ** | ✅ |
| `/portal/content-agent` | **ContentIQ** | ✅ |
| `/portal/instant-quote-agent` | **QuoteIQ** | ✅ |
| `/portal/crm-agent` *(+ [id])* | **ClientIQ** | ✅ |
| `/portal/speed-to-lead-agent` | **LeadIQ** | ✅ |
| `/portal/voice-agent` | **VoiceIQ** | ✅ |
| `/portal/instagram-dm-setter` | **SocialIQ** | ✅ |
| `/portal/logistics` *(+ 4 sub-pages)* | **FleetIQ** | ✅ |
| `/portal/permitiq` *(+ [id])* | **PermitIQ** | ✅ new |
| `/portal/custom-solutions` *(+ [slug])* | Custom Solutions | ✅ |
| `/portal/products` · `solutions` · `analytics` · `projects` · `documents` · `documentation` · `team` · `billing` · `settings` | Shell pages | ✅ |

---

## 4. Authenticated — the other three surfaces

| Tree | Routes | Status |
|---|---|---|
| `/admin/*` | 9 | ✅ platform admin |
| `/growth/*` | 15 | ✅ **your internal sales engine** — not a customer product |
| `/tradeos/*` | 9 | ✏️ **branded TradeIQ; URL still `/tradeos`** — see §6 |
| `/finance/*` | 10 | ❓ shares TradeIQ's account system — see §6 |

`/tradeiq` and `/tradeiq/*` already redirect to `/tradeos` (307), so the new
brand URL works today.

---

## 5. Redirects already in place

```
/autoseo        → /freetools/autoseo   (308 permanent)
/tools          → /freetools           (308 permanent)
/tools/:path*   → /freetools/:path*    (308 permanent)
/tradeiq        → /tradeos             (307 temporary)
/tradeiq/:path* → /tradeos/:path*      (307 temporary)
```

---

## 6. Decisions — all five actioned 2026-07-31

| # | Decision | What happened |
|---|---|---|
| 6.1 | `public/demo.html` | **Deleted.** 27KB orphan holding all 13 remaining pre-rebrand names. `/demo.html` now 308s to `/demo`, the live receptionist demo. |
| 6.2 | `/tradeos` → `/tradeiq` | **Moved.** The route tree is now `/tradeiq`; `/tradeos` and `/tradeos/:path*` 308 to it permanently. |
| 6.3 | `/finance` | **Renamed to FinanceIQ**, kept as its own surface. |
| 6.4 | `public/agents.html` | **Deleted** and removed from the sitemap. `/agents.html` 308s to `/systems`. |
| 6.5 | Homepage | **PermitIQ added** as an eleventh agent card ("Planning & Permits"). |

### Why the old TradeOS URLs are load-bearing, not a courtesy

`/tradeos/doc/<token>` links are sitting in the inboxes of tradespeople's **own
customers** — invoices and quotes emailed before the move. They must resolve
years from now, and the `:path*` form is what carries the token through.
`lib/products/redirects.test.ts` guards that: it asserts the wildcard rule
exists, that the reverse rule was removed (the two together would loop), and
that no source is also a destination.

### On `/finance` staying separate

It shares TradeIQ's account system entirely, so folding it in is possible — but
that is a product decision about how you sell it, not a cleanup. Renaming it
costs nothing and can be undone; merging two navigations cannot. It is now
FinanceIQ in the UI and still its own surface.

### On the homepage

The front page names agents by **function** ("Voice Receptionist",
"Collections", "Workflow & Data"), not by product, so PermitIQ went in as
"Planning & Permits" to match that voice rather than shouting a brand name into
a page that doesn't use them. It is still a 137KB static file outside the app —
that hasn't changed, and it will still need editing by hand next time.

---

## 7. State after the changes

**98 page routes + 6 static HTML files.** Every route resolves, no orphan pages
remain, the authenticated trees are correctly excluded from the sitemap, and
every retired URL redirects somewhere live rather than 404ing.
