# AutomateIQ — Platform Audit & Transformation Roadmap

**Phase 1 deliverable. No application code was changed to produce this.**

Audited: 2026-07-31, against `main` at `4a86cc9`.
Scope of the audit: repository structure, dependency graph, every migration,
the auth/tenancy layer, the agent framework, the AI layer, the API surface, and
the route map. I read the architecture in full; I did **not** line-by-line read
all ~56,000 lines of feature code. Where I say something is missing, I grepped
for it. Where I'm inferring, I say so.

---

## 1. Current System Overview

### Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js **16.2.10**, App Router | Server Components + Server Actions throughout |
| Runtime | React 19, TypeScript 5 | |
| Database | Supabase (Postgres) | `@supabase/ssr` + `@supabase/supabase-js` |
| Auth | Supabase Auth | Cookie sessions, `getUser()` re-validated per request |
| Email | Resend + `@react-email/components` | |
| Validation | Zod 4 | |
| Icons | lucide-react | |
| Billing | Stripe **via raw `fetch`** | No SDK dependency — deliberate |
| Styling | Hand-written CSS | No Tailwind, no component library |
| State | None | No Redux/Zustand/React Query — server-rendered |

**There is no ORM, no UI kit, and no test runner.** `package.json` has exactly
four scripts: `dev`, `build`, `start`, `lint`. This is a lean, deliberate stack
and the discipline shows — the dependency list is 11 production packages for a
56k-line platform. That is an asset, not a gap.

### Size

```
app/         206 files   36,112 lines
lib/          87 files   13,764 lines
components/   45 files    6,416 lines
supabase/     47 files    3,673 lines
```

### What exists today

**Four separate authenticated surfaces**, each with its own login page:

| Surface | Login | Purpose | Tenancy root |
|---|---|---|---|
| `/portal` + `/admin` | `/login` | Customer product portal + platform admin | `businesses` |
| `/growth` | `/growth/login` | Internal sales workspace (Growth Engine) | *none — single tenant* |
| `/tradeos` | `/tradeos/login` | Trades operations product | `trades_accounts` |
| `/finance` | `/finance/login` | Finance product | `trades_accounts` |

**20 API route handlers** across webhooks (Stripe, Resend, inbound email,
Instagram), cron (dispatch, nightly, research-worker), public tools, booking,
lead capture, voice, logistics and signed-token endpoints.

**11 agent modules** in `lib/agents/modules/` — review, website, content,
instant-quote, speed-to-lead, voice, CRM, logistics, Instagram DM setter, plus
a platform module and a `future` placeholder.

**Six free public tools** at `/freetools` (SEO audit, Google profile, missed
calls, quote builder, response time, reviews) — top-of-funnel lead magnets.

**35 database tables** across 23 migrations, plus one private storage bucket
and two SQL tenant-isolation tests.

**Three GitHub Actions workflows** — `morning-brief.yml`, `nightly.yml`,
`research-worker.yml`. All three verified running green as of this morning.

---

## 2. Existing Assets We Can Reuse

This is the important section. **The platform you asked me to build is roughly
60% already here** — it just isn't named as one, and three foundations were
built twice.

### 2.1 The agent framework already exists and is genuinely good

`lib/agents/types.ts` defines `AgentModule` and `AgentTool`. Modules declare
metadata and expose typed, JSON-Schema'd tools; the registry
(`getInstalledAgents` / `getToolsForBusiness`) discovers them at runtime and the
AI Assistant calls them. Every tool receives an **RLS-scoped Supabase client**,
so a tool physically cannot reach another tenant's data.

The file's own docstring states the design goal — *"a future agent integrates by
adding ONE module file and one registry entry — never by changing the assistant,
the shell, or the navigation"* — and the code delivers it.

**Against your five-attribute spec, here's the honest gap:**

| You asked for | Status |
|---|---|
| Name | ✅ `name` |
| Purpose | ✅ `description` + `capabilities[]` |
| Tools | ✅ `tools[]` with JSON Schema + `execute` |
| **Instructions** | ❌ no per-agent system prompt |
| **Permissions** | ⚠️ entitlement-gated only (`business_products`); no per-tool scoping |
| **Knowledge sources** | ❌ nothing |
| **Logs** | ❌ no per-run record |
| **Performance tracking** | ⚠️ `lib/analytics/usage.ts` counts business outcomes, not agent runs |

So: **extend, don't rebuild.** Four additive fields and one new table close this.

### 2.2 The AI layer already does what PermitIQ's hardest feature needs

`lib/ai/complete.ts` + `lib/ai/config.ts` give one `aiComplete()` entry point with:

- **Provider failover** — Anthropic when `ANTHROPIC_API_KEY` is set, Google
  Gemini free tier otherwise, with an `onProvider` callback reporting who
  actually answered.
- **Structured outputs** — a JSON Schema enforced server-side, so parse failures
  are impossible on the Claude path.
- **Effort control**, **timeout budgeting** (explicitly reasoned about against
  `maxDuration`), and **JSON mode**.
- **`attachment: { mimeType, dataBase64 }`** — and the docstring names
  **`application/pdf`** as supported on both providers.

That last one matters more than anything else in this audit. **PermitIQ's
Document Intelligence Agent — "read PDFs, analyse documents, extract
information" — is a prompt and a schema away from working.** There is no
document-AI infrastructure to build.

### 2.3 Multi-tenant foundations, entitlements and billing

- `businesses` + `profiles.business_id`, with RLS enforced through a
  `is_active_tenant_member(business_id)` SQL helper applied consistently.
- `products` + `business_products` — a real entitlement table.
  `guardProduct(key)` is the layout gate; `requireProductEnabled()` is
  re-checked inside every Server Action, with an explicit comment that the
  layout is *"the UX gate, not the security boundary."*
- `lib/products/registry.ts` — code-side product registry (route, icon, accent,
  status) that deliberately mirrors the DB rows. **This is the natural insertion
  point for the vertical-product structure.**
- Stripe billing, `bl_billing_events`, payment links, checkout + webhook
  activation — already wired to entitlements.

### 2.4 Security posture is better than typical

Worth stating plainly, because it's the thing that makes a municipal pilot
conceivable at all:

- Middleware is **explicitly documented as not the security boundary**, citing
  CVE-2025-29927 by number; every admin action re-checks role server-side.
- `getUser()` (revalidates against Auth) is used rather than `getSession()`.
- Private storage bucket with **no `storage.objects` policies at all** — only
  the service-role client touches files; downloads are short-lived signed URLs
  after an RLS-scoped ownership check.
- `isPublicWebHost()` SSRF guard on every user-supplied URL fetch (blocks
  localhost, RFC1918, link-local, cloud metadata).
- Open-redirect interstitial with HMAC-signed tokens on outbound review links.
- Two SQL tenant-isolation tests in `supabase/tests/`.

### 2.5 Reusable infrastructure worth cataloguing

`lib/audit.ts` (admin action log), `lib/analytics/usage.ts` (cross-agent usage
with per-table guards so a missing migration reads 0 rather than throwing),
`lib/tools/token.ts` (HMAC signed self-contained tokens), `lib/tools/rate-limit.ts`,
`lib/growth/db.ts` (`selectAllRows` / `selectAllRowsByIds` — pagination and URL-length
handling for PostgREST), `lib/email/*`, `lib/booking/slots.ts`, `lib/documentation/library.ts`.

---

## 3. Technical Debt

Ordered by what actually blocks the platform vision.

### D1 — Three tenancy roots *(critical, blocks everything)*

| Root | Scoping | Used by |
|---|---|---|
| `businesses` | `is_active_tenant_member()` RLS | portal products: `documents`, `ra_*`, `aa_*`, `va_*`, `wa_*`, `custom_modules`, `business_products`, `bl_billing_events` |
| `trades_accounts` | `owns_trades_account()` RLS | `trades_*` — **and FinanceIQ** (`0029` adds `trades_budgets` on `account_id`) |
| *(none)* | `ge_team_members` allow-list | all 17 `ge_*` tables — single-tenant by design |

A customer is not one identity across the platform: they're a `businesses` row
in the portal and a separate `trades_accounts` row in TradeOS. **Shared
authentication, user management, billing and analytics — the core premise of
your vision — cannot exist across three roots.** Every cross-product feature
you ask for later is blocked on this.

The one piece of good news: **TradeIQ and FinanceIQ already share a root**, so
the vertical story is half-true already.

### D2 — Zero automated tests *(critical for the stated market)*

No vitest, no jest, no playwright, no test script. Correctness today is
maintained by hand-written `node` fixtures in a scratchpad, checked into
nothing. That has worked well at this size — it has repeatedly caught real bugs
— but it is not a control you can show a procurement officer.

**You are proposing to sell to local authorities and municipalities.** Public-sector
security questionnaires ask for evidence of a test and release process. This is
the single biggest gap between where the codebase is and where the pilot needs it.

### D3 — Migrations are applied by hand, with no ledger

No CI step, no Supabase CLI in any of the three workflows. A migration file is
inert until someone pastes it into the SQL editor, and **nothing in the repo
records which ones were applied.** Already logged as J7 in `OUTSTANDING.md`
(0031 is currently pending). Migration numbering also jumps 0006 → 0013, so
0007–0012 either never existed or were lost.

Consequence, verified this morning: `loadGrowthSettings()` named a column from
an unapplied migration, PostgREST 400'd the whole request, and *every* setting
silently fell back to a default — including the booking URL embedded in
outreach emails. That class of failure recurs for as long as "applied" is
untracked.

### D4 — Four login surfaces

`/login`, `/growth/login`, `/finance/login`, `/tradeos/login`. Adding PermitIQ
naively makes five. Each is a separate place for a session bug to live.

### D5 — `profiles.role` constraint vs. the `'growth'` role

`0001` constrains `role` to `('admin','customer')` and no later migration widens
it. `lib/auth/require-admin.ts` branches on `profile?.role === 'growth'` — a
value that constraint would reject. Growth membership is actually carried by
`ge_team_members`, so this is an **unreachable fallback branch, not a live
break**. Low severity; flagged because it's exactly the kind of drift that
becomes a real bug when someone later "fixes" the constraint.

### D6 — Agent framework missing instructions / permissions / knowledge / logs

Detailed in §2.1. No per-agent system prompt, no per-tool permission scoping, no
knowledge sources, no run log. PermitIQ needs all four on day one.

### D7 — Smaller, known items

Carried in `OUTSTANDING.md`: per-instance rate limits (F3), no `ra_customers`
email dedupe (K4), no booking IP rate limit (K5), plus six decisions blocked on
you (J1–J6, including the still-unresolved **15 / 30 / 45-minute session length**
contradiction).

---

## 4. Recommended Improvements

### R1 — Add a product *family* layer. Do **not** rename product keys.

Your Phase 2 asks to rename "Review Agent" → "ReputationIQ Agent", etc.

**`products.key` is a foreign entitlement key.** Every customer's access lives in
`business_products` joined on it, and `guardProduct("review-agent")` is called
throughout the codebase. Renaming keys would silently revoke live customers'
products — precisely the breakage you've told me to avoid.

**The fix costs one field.** Add `family` to `ProductDefinition` and a display
name; keys stay frozen forever:

```ts
export type ProductFamily = "core" | "tradeiq" | "financeiq" | "permitiq" | "reputationiq";

{ key: "review-agent",        // ← never changes; entitlements depend on it
  family: "reputationiq",
  name: "ReputationIQ Agent", // ← what the customer sees
  legacyName: "Review Agent", // ← so support can still find it
  ... }
```

The portal then groups tiles by family and the platform *looks* like Salesforce
without a single destructive change. Marketing rename, zero migration risk.

### R2 — Consolidate on `businesses` as the single tenancy root

`businesses` is the root with real RLS, entitlements, billing and admin
tooling. TradeOS/FinanceIQ's `trades_accounts` should become a **profile
attached to a business**, not a parallel root.

Done additively: add a nullable `trades_accounts.business_id`, backfill,
dual-read, then make it authoritative. Nothing is dropped and no customer
loses access at any point. `ge_*` stays single-tenant — it's your internal sales
workspace, not a product, and converting it buys nothing.

**PermitIQ must be built on `businesses` from commit one.** Adding a fourth root
would make the consolidation permanently impossible.

### R3 — Introduce a test harness before PermitIQ, not after

Vitest + a `test` script + a CI workflow running `lint`, `build`, `test` on every
PR. Seed it by porting the scratchpad fixtures that already exist (send-review
gates, inbound classification, the ramp, SEO scoring) — that's real coverage on
the highest-risk paths for maybe a day's work, and it converts a practice you're
already following into evidence you can show a buyer.

### R4 — Agent Framework v2 — additive fields plus a run log

```ts
export type AgentModule = {
  // ...everything today, unchanged...
  instructions?: string;                    // system prompt
  permissions?: AgentPermission[];          // "documents:read", "email:send"
  knowledgeSources?: KnowledgeSourceRef[];  // catalog / table / doc set
};
```

Plus one table, `agent_runs` (business_id, agent_key, tool, status, latency_ms,
tokens_in/out, provider, error, created_at) written by a wrapper around tool
execution. That single table delivers **Logs** and **Performance tracking**
together, for every agent, including the eleven that already exist.

`permissions` should start as *declared and logged*, enforced in a second pass —
enforcing on day one risks breaking the eleven live modules.

### R5 — Migration discipline

A `schema_migrations` ledger table plus a CI check that fails when a migration
file has no applied record. Turns D3 from a recurring silent outage into a
build failure.

---

## 5. Required Refactoring

Strictly ordered — each unblocks the next.

| # | Refactor | Why it's required | Risk |
|---|---|---|---|
| F1 | `family` + display-name layer in `lib/products/registry.ts` | Enables the vertical product structure | **None** — additive, keys frozen |
| F2 | `lib/auth/*` → one `requireTenant()` returning `{ user, profile, business }`, with existing guards kept as thin wrappers | One session contract for all products | Low — wrappers preserve call sites |
| F3 | Unified `/login` with post-auth routing by entitlement; four existing login routes kept as redirects | Removes D4 without breaking a bookmark | Low |
| F4 | Agent Framework v2 fields + `agent_runs` | Unblocks the five PermitIQ agents | Low — optional fields |
| F5 | `trades_accounts.business_id` backfill, dual-read → authoritative | Removes D1 | **Medium** — needs scratch-Postgres validation and a rollback plan |
| F6 | Vitest + CI gate | Removes D2 | None |

**F5 is the only genuinely risky item, and it's the one that matters most.** It
should not run in the same window as the PermitIQ build.

---

## 6. PermitIQ MVP — Proposed Design

### 6.1 What I'd cut from the brief, and why

You said "do not attempt to build a full government system" — agreed, and I'd
go further. **Ship the Applicant side and the AI Review Assistant first; the
Reviewer Dashboard second.**

Reason: an architect or planning consultant can buy on their own signature this
quarter. A local authority cannot — public procurement, security review and data
residency will outlast a 90-day window. **Recruit municipalities as design
partners, not as pilot customers.** The reviewer dashboard is what earns their
input; the applicant side is what earns revenue meanwhile.

### 6.2 Data model (all `pq_` prefixed, all on `businesses`)

| Table | Purpose |
|---|---|
| `pq_applications` | business_id, reference, jurisdiction (`ie`/`us`), authority, application_type, site address, applicant, status, submitted_at, decision_due_at |
| `pq_documents` | application_id, business_id, doc_type, storage_path, content_type, page_count, extraction jsonb, extracted_at |
| `pq_requirements` | Catalog: jurisdiction + authority + type → required document codes, mandatory flag, guidance |
| `pq_application_requirements` | Per-application checklist state: `satisfied` / `missing` / `unclear`, evidence doc, source (`ai`/`human`) |
| `pq_reviews` | One AI review run: agent_key, summary, risk_flags jsonb, model, tokens |
| `pq_notes` | Reviewer notes |
| `pq_events` | Append-only audit history (actor, type, payload) |

Reused unchanged: `businesses`, `profiles`, `products` / `business_products`
(entitlement key `permitiq`), Stripe billing, notifications via Resend,
`agent_runs`. New private storage bucket `permits`, same service-role +
signed-URL pattern as `documents`.

`pq_requirements` as a **data-driven catalog** rather than hard-coded rules is
the decision that makes both jurisdictions tractable: Ireland's planning
requirements and a US municipality's permit checklist become rows, not code.

### 6.3 The five agents, mapped to existing infrastructure

| Agent | Built on | New work |
|---|---|---|
| Document Intelligence | `aiComplete` + PDF attachment + structured-output schema | Extraction schema per doc type |
| Compliance Checklist | `pq_requirements` + extraction output | Matching logic |
| Application Review | Both of the above | Summary + risk-flag prompt |
| Planning Rules Assistant | `knowledgeSources` (R4) | Ireland rule set first, US second |
| Communication | `lib/email/*` + the outreach review-gate pattern | Draft-only, never auto-send |

**The Communication Agent must inherit the Growth Engine's send-review gates.**
That pattern (`reviewOutreachEmail`, `sanitizeOutreachBody`, held-send logging)
exists because an email with the wrong client's details in it costs a customer
permanently. On a planning application it costs considerably more.

### 6.4 90-day sequence

| Window | Deliverable |
|---|---|
| **Days 0–14** — Core | F1, F2, F4, F6. Product families visible, agent framework v2, `agent_runs`, tests + CI green. |
| **Days 15–45** — PermitIQ v1 | Applications CRUD, document upload, Document Intelligence + Compliance Checklist agents, applicant tracking UI. **Demoable.** |
| **Days 46–70** — Reviewer + depth | Reviewer queue, AI summaries, document viewer, risk flags, audit history, Communication Agent. F3. |
| **Days 71–90** — Pilot hardening | F5 (tenancy consolidation), security review, seeded demo tenant, onboarding, 3 design partners live. |

---

## 7. Decisions I'm taking as CTO

Stated rather than asked, per your instruction — tell me if you want any reversed:

1. **Product keys are frozen.** Renaming is a display-layer change. *(Protects live entitlements.)*
2. **PermitIQ is built on `businesses`.** No fourth tenancy root, ever.
3. **Applicant side ships before the reviewer dashboard.**
4. **Pilot targets are architects, engineers and planning consultants.** Municipalities are design partners in the 90-day window, not buyers.
5. **Tests land before PermitIQ, not after.** Non-negotiable for the stated market.
6. **No new technologies.** Vitest is the only addition, and it's a dev dependency.
7. **`ge_*` stays single-tenant.** It's internal tooling, not a product.

## 8. Answered 2026-07-31

### 8.1 The Growth Engine becomes a product — as a **separate, minimal build**

Jude: *"Yes but a minimal version compared to what we use privately for outreach."*

**Decision: build TradeIQ Growth Agent as a new, small product on `businesses`.
Do NOT multi-tenant the existing `ge_*` tables.**

This is the safest reading of "minimal", and it's also the right architecture:

- The `ge_*` engine is 17 tables, a 07:00 send pipeline, editorial review gates,
  an autopilot ramp, a nightly routine and a research worker. It is the thing
  that earns the company's money, and it must never break. Retro-fitting a
  `business_id` onto all 17 tables and re-writing every query, cron and RLS
  policy around it is the single highest-risk change available in this codebase
  — for a *lite* product that needs maybe 20% of it.
- A customer's Growth Agent needs: import leads, AI-draft an intro, queue,
  send, capture replies, chase. Not: proposal studio, LinkedIn caption
  generation, lead recycling, solution matching, call sheets, the morning brief.

So: **new `gr_*` tables on `businesses`, reusing `lib/growth` as a library** —
`ai.ts` (drafting), `email.ts` (the send-review gates), `inbound-classify.ts`,
`scoring.ts`, `dates.ts`. The valuable, hard-won parts are shared as code; the
internal engine's schema and crons are untouched.

**The send-review gates are mandatory in the customer product.** A customer
whose outreach goes out with another company's details in it is a lost customer
and a damaged sending domain — the exact failure those gates exist to prevent.

### 8.2 PermitIQ — Ireland production-ready, USA visible

Jude: *"Ireland and USA but product ready for Ireland today and base for USA visible."*

**Decision: `jurisdiction` is a first-class column from the first migration, not
retro-fitted.** `pq_applications.jurisdiction` (`ie` | `us`) and
`pq_requirements` keyed on `(jurisdiction, authority, application_type)`.

- **Ireland** ships with a fully seeded requirements catalog and is sellable.
- **USA** ships with the same schema, the jurisdiction selectable, and an
  honest empty state naming the municipalities not yet covered — visible,
  demoable, and truthful about what it does today.

The catalog is rows, not code, so adding a US municipality is a seed insert
rather than a release. That's what makes "base for USA visible" cheap instead
of a second build.

### 8.3 Session length (J4) — decided, since the answer was "I don't know"

**Decision: the customer hears ONE number everywhere — 15 minutes.**

15 is the right *promise* in cold outreach: it's what makes a stranger say yes,
and there's no benefit to talking a prospect up to 30 before they've met you.
Every ask in the product already uses it — the call script, touch 3, the
morning brief, the prospect call sheet.

**Two corrections to the register while fixing this.** `OUTSTANDING.md` J4 said
*"`lib/booking/slots.ts` books 45 minutes (the actual calendar hold)"*. That was
wrong, and I repeated it in the first draft of this document:

1. **Nothing has ever held 45 minutes.** `durationLabel: "45 minutes"` is a
   *string*, used only in the booking page hero, the FAQ answer and the
   confirmation email. Slot spacing is `slotMinutes: 30` and nothing else. So
   leads were being told 45 minutes while slots sat 30 apart — if the session
   had really run 45, back-to-back bookings would have overlapped by 15.
2. **There were more than three variants.** The AI system prompts that *generate
   the outreach* (`lib/growth/ai.ts` ×2, `lib/growth/research.ts`) instructed the
   model to sell a **30-minute** session, while the ask instructions in the same
   file said **15**. So `ai.ts` contradicted itself, and generated cold emails
   were likely promising 30 against a 15-minute call script.

Changed to 15: the lead confirmation email, the three AI system prompts, and
`durationLabel`. **No booking logic touched** — `slotMinutes`, `minLeadHours`
and availability generation are untouched, so this stays a copy-only change to
a revenue path. At 15 minutes against 30-minute spacing there's now a real
buffer rather than a phantom overlap.

---

## 9. Still open

`OUTSTANDING.md` J1, J2, J3, J5, J6 — plus **J7: migration 0031 still needs
pasting into the Supabase SQL editor.**

---

## 10. Phase 2 progress

| Ref | Item | Status |
|---|---|---|
| F1 | Product family layer | ✅ shipped 2026-07-31 — portal grouped into AutomateIQ Core / TradeIQ / ReputationIQ, keys frozen |
| F4 | Agent Framework v2 | ✅ shipped 2026-07-31 — `instructions`, `permissions`, `knowledgeSources` (all optional) + `agent_runs` (migration 0032) |
| F6 | Vitest + CI gate | ✅ shipped 2026-07-31 — 97 tests, `.github/workflows/ci.yml` gates every PR |
| F2 | One `requireTenant()` | ✅ shipped 2026-07-31 — session + active business in one guard; suspended tenants get an honest page instead of a hollow portal |
| F3 | Post-auth routing by account | ✅ shipped 2026-07-31 — fixed an infinite `/portal ↔ /admin` redirect. **Login pages deliberately NOT merged, see below** |
| F5 | `trades_accounts` → `businesses` | last, days 71–90 |

### Note on F4 as shipped

Two deliberate limits, both to protect the eleven live agents:

- **`permissions` is declared and displayed, not enforced.** No live module
  declares a permission set today; switching on enforcement in the same change
  that introduces the field would have broken all eleven at once. Enforcement is
  a separate, verifiable change once every module declares its set.
- **`instructions` is inert until declared.** The assistant's system prompt was
  verified byte-for-byte identical (1089 chars before and after) with no module
  declaring the field, so today's behaviour is unchanged and PermitIQ's agents
  are the first real users.

`agent_runs` stores **no tool input or output** — those routinely carry customer
names, emails and quote figures, and a debug log is the wrong place for personal
data to accumulate. The row records that a call happened, how it went and how
long it took.

### Note on F3 — scope changed on the evidence

F3 was written as *"unified `/login`, four existing login routes kept as
redirects."* **I did not merge them, and I'd argue against it.**

Reading the four surfaces first changed the picture. All four use the same
`signInWithPassword`; where they differ is real — `/login` carries password
reset, and **TradeOS and Finance both carry self-serve signup** with
product-specific `emailRedirectTo` targets. Folding those into one page means
either dropping signup or building a four-mode login. That is a redesign of the
one surface where a mistake locks every customer *and Jude* out, for a benefit
that is mostly cosmetic — and it does not unblock PermitIQ, which can use
`/login` + `/portal` like any other portal product. The original worry ("adding
PermitIQ naively makes five logins") is answered by not adding a fifth, which
costs nothing.

What reading them *did* find was a hard failure worth far more than the merge:

`requireSession()` sent anyone without a `business_id` to `/admin`, and
`requireAdmin()` sent any non-admin to `/portal`. For `role='customer'` with no
business those two are a **cycle** — `/portal → /admin → /portal → …` ending in
`ERR_TOO_MANY_REDIRECTS`. requireAdmin's escape hatch (`role === 'growth'`) can
never fire, because the CHECK constraint on `profiles.role` only permits
`'admin'` and `'customer'` — **that's D5 from §3, and it was load-bearing after
all.**

And the account shape is common: TradeOS and Finance have self-serve signup, and
the auth trigger creates exactly `role='customer'` with no `business_id` when the
metadata carries none. So **any TradeOS or Finance customer reaching `/portal`
hit the loop** — including straight from the main `/login` form, which defaults
to `/portal` after sign-in.

`resolveHomeRoute()` now answers where an account belongs, with two properties
that matter: a portal business always outranks a `trades_accounts` row (because
`requireTradesAccount()` *creates* one on first visit, so a portal customer who
once clicked into `/tradeos` has a shell row forever), and the fallback is a
**terminal page that runs no guard**, so a wrong answer can never re-form a
cycle. D5 needs no migration now — nothing routes on `role === 'growth'` any more.

### Note on F6 as shipped

97 tests over the five places a silent regression is most expensive: the
outbound **send-review gates**, **inbound classification**, **review-link
safety**, the **product/entitlement registry**, and **return-date parsing**.
Scope is pure logic only — functions that decide something important and can be
checked without a database, a network call or a running server. D2 in §3 is
closed as a *control*; coverage is a starting point, not a finish line.

The suite earned its keep on the first run by catching a live bug: `parseReturnDate`
read a 4-digit year's first two digits as a day, so *"back on 25 August 2026"*
resolved to **20 August** and the chase went out five days early, while the
prospect was still away.

### Note on F2 as shipped

`requireSession()` is **unchanged** — 51 call sites depend on its shape and
redirect behaviour, and several are Server Actions and Route Handlers where a
new redirect would be a behaviour change. `requireTenant()` builds on top of it
and is adopted in **one place**: the portal layout, which every portal page
already passes through.

It closed a real hole rather than just tidying the guards. The layout loaded the
business through the **RLS-scoped** client, and `is_active_tenant_member`
requires `status = 'active' AND deleted_at IS NULL`. For a suspended customer
the row came back null, the business name fell through to the placeholder
*"Your business"*, and the portal rendered in full with every panel empty —
because the same predicate hid all their data too. Someone suspended over an
unpaid invoice saw what looked exactly like their account being wiped, with
nothing on screen to say otherwise. `/account-unavailable` says it plainly.

That page sits **outside** the `/portal` tree on purpose: inside it, the portal
layout would guard the page that exists to explain why the guard fired.

**There is no lint step in CI, deliberately.** `npm run lint` runs `next lint`,
which Next 16 removed, and ESLint isn't installed or configured in this repo at
all — so the script has been dead since the Next 16 upgrade. A step that always
fails would make the gate worthless on day one. Tracked as K6.

---

*Phase 1 complete. Phase 2 began 2026-07-31 with F1 (product families) and F4
(Agent Framework v2).*
