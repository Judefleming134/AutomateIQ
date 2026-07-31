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

## 6. What actually needs a decision

### 6.1 `public/demo.html` — 27KB, orphaned, and holding stale branding 🗑️

**Nothing links to it.** Not in the sitemap, not referenced from any page or
route — but still publicly served at `automateiq.ie/demo.html` to anyone with
the URL or an old search result.

It contains **all 13 remaining old product names on the site**: "Review Agent"
×3, "Content Agent" ×3, "Instant Quote" ×3, "AI Assistant" ×2, "Speed-to-Lead"
×2. It is superseded by `/demo`, the live receptionist demo built as a Next
route with `noindex` set.

**Recommendation: delete it.** It is the only place on the public site still
showing the pre-rebrand names, and it is doing no work. If you'd rather keep it,
I'll rename the products inside it instead — but a 27KB orphan competing with
the real demo page is worth losing.

### 6.2 `/tradeos` — do you want the URL moved to `/tradeiq`? ❓

Right now: brand says TradeIQ everywhere, URL stays `/tradeos`, and `/tradeiq`
redirects in. That was deliberate — `/tradeos` is a signed-in product whose
customers have bookmarks, saved passwords and emailed document links pointing at
it.

**Moving it properly** means making `/tradeiq` canonical, turning `/tradeos`
into a permanent redirect, and re-checking every signed document link. Doable
and safe if you want it; it just isn't free, and today's arrangement already
lets you say "automateiq.ie/tradeiq" out loud.

### 6.3 `/finance` — should it be FinanceIQ, and should it be separate? ❓

It shares TradeIQ's account system entirely (`trades_accounts`); the only
difference is which login screen you land on. It has 10 routes and its own login
page. Two questions: does it get the **FinanceIQ** name in the UI, and should it
stay a separate surface or become a section inside TradeIQ?

### 6.4 `/agents.html` — 50KB static, indexed at priority 0.7 ❓

A big static page listing the agents, ranked in your sitemap above the legal
pages. It doesn't carry the old product names, but it predates the vertical
structure (AutomateIQ Core / TradeIQ / ReputationIQ / PermitIQ) and won't
mention PermitIQ at all.

**Worth a decision:** refresh it to match the new product families, or fold it
into `/systems` and redirect. Two pages describing your product range is one
too many.

### 6.5 The homepage is a 137KB static file ❓

`public/index.html`. It works and it's fast, but it's outside the app — so it
never picks up a rebrand, a new product, or the design system automatically.
PermitIQ won't appear on your front page until someone edits that file by hand.

Not urgent. Worth knowing before the next launch.

---

## 7. Nothing here needs removing for correctness

Every route resolves, no orphan pages under `/portal` or `/growth`, and the
authenticated trees are correctly excluded from the sitemap. The only file I'd
actually delete is `demo.html`.
