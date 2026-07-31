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
| `/products` | Product range index — all three, both doors | ✅ new |
| `/products/tradeiq` · `/financeiq` · `/permitiq` | Public product pages, each with **Log in** and **Request access** | ✅ new |
| `/systems` | Systems overview | ✅ |
| `/savings` | Savings calculator | ✅ |
| `/freetools` | Free tools hub | ✅ |
| `/freetools/autoseo` | SEO auditor | ✅ |
| `/freetools/google-profile` | Google Business Profile checker | ✅ *(needs J1 key)* |
| `/freetools/response-time` | Response-time test | ✅ *(needs J2)* |
| `/freetools/missed-calls` | Missed-call calculator | ✅ |
| `/freetools/reviews` | Review writer | ✅ |
| `/freetools/quote-builder` | Quote builder | ✅ |
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
| `/tradeiq/doc/[token]` | Signed invoice/quote view (`/tradeos/doc/*` 308s here) |
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
| `/tradeiq/*` | 9 | ✅ **TradeIQ** — moved from `/tradeos` (see 6.2) |
| `/finance/*` | 10 | ✅ **FinanceIQ**, its own surface — see §6 |

`/tradeos` and `/tradeos/:path*` 308 to `/tradeiq`, permanently: the old URLs
carry signed document tokens sitting in strangers' inboxes.

---

## 5. Redirects already in place

```
/autoseo        → /freetools/autoseo   (308 permanent)
/tools          → /freetools           (308 permanent)
/tools/:path*   → /freetools/:path*    (308 permanent)
/tradeos        → /tradeiq             (308 permanent)
/tradeos/:path* → /tradeiq/:path*      (308 permanent)
/demo.html      → /demo                (308 permanent)
/agents.html    → /systems             (308 permanent)
/permitiq       → /products/permitiq   (308 permanent)
/financeiq      → /products/financeiq  (308 permanent)
```

Plus case correction in `proxy.ts`: any path whose first segment contains a
capital letter is 308'd to its lowercase form, when that form is a route we
actually have. `/TradeIQ`, `/PermitIQ`, `/PRODUCTS` all land; `/Nonsense`
still 404s.

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

### On the homepage being a static file

Measured rather than assumed. Of the ~147KB: **54.6KB is one inline `<style>`
block, 56.3KB is eleven inline `<script>` blocks, and only ~36.5KB is actual
markup.**

**I did not extract the CSS, and that is deliberate.** Pulling 54.6KB into
`/home.css` would shrink the HTML and read as an improvement — but for a
marketing page whose visitors are overwhelmingly first-time, inline CSS avoids
a render-blocking round trip and paints *faster*. Extracting it would trade a
real conversion metric for a tidier file listing. The eleven script blocks are
riskier still: they are inline IIFEs that run at parse position, and moving
them to a deferred external file changes when they execute — not something to
do without a browser to verify in.

**The size was never the real problem.** The real problem is that the app
cannot reach the file, so codebase-wide changes miss it silently — which has
now happened twice (the *IQ rebrand skipped it; `demo.html` sat there for weeks
showing retired names).

`lib/homepage.test.ts` fixes the cause instead of the symptom. It runs in CI on
every pull request and asserts the page cannot silently disagree with the
platform: no retired product name, every product family named, the proof
figures matching `lib/proof.ts`, the conversion path intact, balanced tags,
sequential section numbers, and no in-page anchor pointing at a section that
doesn't exist. Verified by breaking the file five different ways — all five
were caught.

The page stays hand-crafted. It just can't drift in silence any more.

---

## 7. State after the changes

**98 page routes + 6 static HTML files.** Every route resolves, no orphan pages
remain, the authenticated trees are correctly excluded from the sitemap, and
every retired URL redirects somewhere live rather than 404ing.

---

## 8. Public product pages — added 2026-07-31

`/tradeiq`, `/finance` and `/portal/permitiq` are all behind a login. Correct
for a product, useless on a business card: the URL said out loud on a call
landed a stranger on a password box with no explanation of what they were
logging in to, and no way to ask for an account.

`/products` and `/products/[slug]` fix that. Each product page carries **both
doors** — **Log in** for the customer who already pays, **Request access** for
the one who might. A page with only one turns half its visitors away.

- Content is data in `lib/products/marketing.ts`, so a fourth product is a
  data entry rather than a new page, and the sitemap picks it up automatically.
- Statically generated (`generateStaticParams`) — three prerendered HTML files.
- The **Log in** hrefs are plain strings, so `lib/products/marketing.test.ts`
  checks each one against the real route tree on disk. Verified by pointing
  TradeIQ at the retired `/tradeos/login`: the test failed.
- **Request access** posts to the existing `/api/lead` with a `source`.
  `source` is **allow-listed** (`resolveLeadSource`) — it is the field the
  leads list is filtered by, and a public endpoint that writes arbitrary
  strings into it poisons the one dimension that says which product sells.
  An unrecognised value falls back to the landing-page source; the lead is
  never dropped over its label.
- Existing behaviour is untouched: the homepage form still posts no `source`
  and still stores `automateiq-landing`.

---

## 9. Homepage brought in line — 2026-07-31

The front page was still selling a pre-launch product with no way in.

**Information that was wrong or missing**

| Was | Now |
|---|---|
| No **Log in** anywhere on the marketing site | Log in in the header, the footer and the colophon |
| Hero: "from trades to clinics", no product named | Names TradeIQ, FinanceIQ and PermitIQ in the first paragraph |
| "Get early access" in hero, nav and colophon | Gone — the product is live with 500+ jobs through it |
| Products section: a 5-node diagram and nothing to click | Three product cards, each with **Log in** + **See &lt;product&gt;** |
| Colophon "Serving trades" | "Trades · finance · planning", plus a Products group |
| Header carried **Free Tools** twice, to two different places | One Free Tools, and Products in the freed slot |

**The built-in assistant was answering with pre-launch copy** — "we're
onboarding early-access partners", "drop your email in the early-access form" —
and had never heard of the three products, the ClearWater proof, security or
logging in. Rewritten against what the platform actually is, and it now points
at `/book` and `/products` instead of a waitlist.

**It was also matching keywords wrong.** `answer()` returned the *first* entry
with a matching keyword, and one early entry carried the bare key `'do'` — a
substring of "how much **do**es it cost", "what **do**es it cost", "how **do** i
get started" and "**do** you have a demo". **Every pricing question on the
homepage was answered with the generic capabilities blurb**, and one of the four
suggested chips returned the wrong answer outright. Now scored by keyword
length, which fixes the class rather than the one key.

**The agent cards said "Click to preview" and navigated away.** All four linked
`/agents.html#<slug>` — deleted, 308s to `/systems`, and the redirect drops the
anchor. The preview panel they promised was already built and already in the
DOM; only the eleven chips were wired to it. The cards now carry `data-id`, so
the existing handler catches them. Three page footers (`/book`, `/systems`,
`/savings`) pointed at the same dead page and now point at `/products`.

**Visual polish.** Every multi-word header label was breaking mid-phrase
("Free / Tools", "Book a / Call") at every width from 1440px down — verified
against `origin/main`, so it predates this pass. Fixed with `white-space:nowrap`
scoped to the header. The colophon grid is `auto-fit` instead of a hard 5
columns, which had been orphaning the last group on its own row.

Verified in Chromium at 1440px and 390px: zero horizontal overflow, zero page
errors, all four agent cards open their own preview, all eleven chips still
work. `lib/homepage.test.ts` grew to 22 tests covering each of the above; each
new guard was verified by re-breaking the thing it guards.

---

## 10. Correction — the case fix shipped dead, and is now live

**PR #486 said "brand URLs now survive capital letters". They did not.** Every
capitalised URL on the site still 404'd, from the day that PR merged until
this one. Verified against a running `next start`:

```
BEFORE                              AFTER
/TradeIQ    404                     /TradeIQ    308 -> /tradeiq
/PermitIQ   404                     /PermitIQ   308 -> /products/permitiq
/FinanceIQ  404                     /FinanceIQ  308 -> /products/financeiq
/Products   404                     /Products   308 -> /products
/Book       404                     /Book       308 -> /book
/Nonsense   404                     /Nonsense   404      (still, correctly)
```

**Why it was dead.** `canonicalPath()` was correct and thoroughly unit-tested.
It was called from `updateSession()`, which runs from `proxy.ts` — whose
matcher is an **allowlist**: `/portal/:path*`, `/admin/:path*`,
`/growth/:path*`, `/login`. `/TradeIQ` matches none of them, so the function
was never reached. Sixteen passing unit tests, zero production effect. This is
the "reporting success for work that didn't happen" class in CLAUDE.md, and a
unit test of a pure function is exactly how it hides.

**The fix.** One extra matcher entry — `/:segment([^/]*[A-Z][^/]*)/:path*` —
matching any path whose first segment contains a capital. Deliberately narrow
rather than the usual catch-all `/((?!api|_next|.*\..*).*)`: a catch-all would
route the fully-static marketing homepage through a Node function on every
visit. `updateSession()` also now runs the case check **before** building the
Supabase client and short-circuits for anything that isn't a session surface,
so a capitalised miss costs no auth round trip. Confirmed with an instrumented
proxy: `/`, `/products`, `/book`, `/freetools` do not invoke it; `/Products`
and `/TradeIQ` do.

**Two brand names had no URL at all, in any casing.** PermitIQ lives at
`/portal/permitiq` and FinanceIQ at `/finance`, so `/permitiq` and
`/financeiq` — the names said out loud and printed on a card — were plain
404s. Both now 308 to their public product page, which explains the product
*and* carries the Log in button, rather than to the app behind a password box.

**The guard.** `lib/routing/wiring.test.ts` tests the joins, not the function:
that the matcher reaches `canonicalPath` for every known segment, that the
static marketing site still bypasses the proxy, and that every segment in
`KNOWN_SEGMENTS` resolves to a real route or a redirect source. Its model of
Next's matcher is calibrated against nine results recorded from the running
server, so it cannot quietly assert itself. Verified by restoring the original
allowlist: 8 tests fail.
