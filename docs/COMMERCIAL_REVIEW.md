# AutomateIQ — Commercial & Architectural Review

_Senior architect + SaaS strategist review of the agent portfolio. Every
finding below was acted on, not just reported — the code changes are in the
same commit as this document._

---

## 1. Executive summary

AutomateIQ is a **multi-tenant AI platform for local service SMBs** with an
AI Assistant at the centre orchestrating specialist agents. The architecture
is genuinely sound: modular agent registry, row-level-security tenant
isolation, a swappable LLM provider layer, and shared cores that keep the
codebase lean. This review did **not** require a rewrite — it required
hardening, standardisation, and closing the few gaps that stood between
"impressive demo" and "sellable product."

**The single most important commercial recommendation:** sell this as a
**bundled "AI workforce" subscription anchored on the AI Assistant**, not as
seven separate SaaS products. The individual agents are the value delivery;
the Assistant + shared business data (knowledge, price guide, contacts) is
the moat and the reason a customer stays.

**Durability (12–24 months):** the real risk to every AI agent is
commoditisation by frontier chat models. The defence is already the right
one and was reinforced in this pass: the moat is not the model, it's (a) the
grounding in the customer's own business data, (b) agents that *do things*
(send, quote, reply) rather than just chat, and (c) the multi-tenant
platform. The LLM is correctly treated as a swappable commodity — now
centralised in `lib/ai/config.ts` so upgrading models is a one-line change.

---

## 2. Changes made in this pass (and why)

| # | Change | Why |
|---|---|---|
| 1 | **Centralised LLM config** (`lib/ai/config.ts`) — model IDs, endpoints, provider selection, and the Gemini "thinking-off" default now live in one file; `aiComplete` and the AI Assistant both import it. | Removed duplicated magic strings across two files; makes a model upgrade a one-line change — the key durability lever against commoditisation. |
| 2 | **Fixed a reliability bug that made 3 agents look broken on the free tier** — Gemini 2.5 Flash bills thinking tokens against `maxOutputTokens`, so a tight budget returned empty text. Disabled thinking + raised budgets; empty output now throws a retryable error instead of silently returning "". | On the default (free Gemini) tier, Content/Quote/Assistant could return blank. Unsellable if a prospect sees that in a demo. (Shipped in V6; hardened here.) |
| 3 | **Standardised the entitlement guard** — added `guardProduct(key)`; all 7 agent layouts now use it (or the `productLayout` factory) instead of 7 hand-rolled copies. | Consistency + one place to change the gate; removed ~90 lines of duplication. |
| 4 | **Made Speed-to-Lead genuinely sellable** — added a per-business `stl_settings` table: editable subject + message template with `{{name}}`/`{{business}}` placeholders and an on/off switch, respected at send time. | It was a hardcoded canned email — not a product. Now the customer owns the message, which is the difference between "a feature" and "something they'll pay for." |
| 5 | **Business knowledge promoted to a platform-level Setting** (shipped V6) so Content Agent is sellable standalone, not dependent on owning the AI Assistant. | A Content-only customer previously had nowhere to set their brand voice. |
| 6 | **Analytics now covers all 7 agents** (content, quotes, instant replies). | The dashboard no longer looks half-empty for content-led customers. |
| 7 | **Docs** — `docs/AGENTS.md` (architecture + "add an agent" checklist) and this report. | Onboarding + investor/sales readiness. |
| 8 | **Dead-code sweep** — found nothing to remove (no orphan files, no unused deps, no TODOs). | The incremental shared-core approach kept it clean; recorded as a positive finding. |

### Merge / duplication analysis (and why nothing was force-merged)

The brief asked to merge duplicate agents. I assessed every pair honestly:

- **CRM Agent vs Review Agent's customer list vs Website Agent's leads** —
  CRM is the *union* view; the per-agent lists are *in-context* views. These
  are complementary, not duplicative. Merging would remove useful surfaces.
  **Kept separate; CRM positioned as the cross-cutting hub.**
- **Speed-to-Lead vs Website Agent** — Speed-to-Lead consumes Website Agent
  leads but is a distinct, separately-sellable category with its own ROI
  story. **Kept as a distinct, now-configurable module.**
- **Content / Quote / Assistant** — all use an LLM, but the shared logic was
  *already* extracted into cores + `aiComplete`. **No further merge needed.**

Conclusion: there is **no true duplication** to merge. The overlap is
deliberate layering (in-context vs unified), which is correct product design.
Justifying "leave unchanged" was the right call here, per the brief's own
instruction.

---

## 3. Per-agent commercial scorecard

Scores are 1–10 for **realistic willingness-to-pay today** by the target SMB.

### Review Agent — 9/10 ⭐ flagship
- **Problem solved:** businesses lose local-search rank and trust without a
  steady flow of Google reviews; asking manually is awkward and forgotten.
- **Ideal customer:** local service SMBs — trades, dentists, clinics,
  salons, restaurants, garages.
- **Would they pay?** Yes — a proven category (Podium, NiceJob, Birdeye all
  charge €100–400/mo). Clear, measurable ROI (reviews → ranking → calls).
- **Pricing:** **Subscription**, €49–99/mo.
- **Maintenance:** Low (email + cron, stable).
- **Implementation cost:** Built. ~Done.
- **Target market:** Local service SMBs, Ireland/UK first.
- **Sell priority:** **#1** — easiest sale, strongest ROI story, lowest risk.

### Instant Quote Agent — 8/10 ⭐ differentiated
- **Problem solved:** slow, inconsistent quoting loses jobs; owners quote at
  night. Speed and consistency win work.
- **Ideal customer:** trades and field service with a priced catalogue —
  plumbers, electricians, builders, landscapers, cleaners.
- **Would they pay?** Yes. Genuinely differentiated: it quotes from **their**
  price guide, never invented numbers — the #1 objection to generic AI.
- **Pricing:** **Subscription**, €49–99/mo (or usage-based per quote).
- **Maintenance:** Low–medium (prompt + parsing).
- **Target market:** Trades / field service.
- **Sell priority:** **#2** — differentiated, high-ROI, defensible.

### AI Assistant — 8/10 ⭐ the moat
- **Problem solved:** owners are time-poor and juggle tools; one place to ask
  and *do* anything across the business.
- **Ideal customer:** every SMB owner on the platform.
- **Would they pay?** As the platform anchor, yes — it's the "one AI
  employee" story and the reason the bundle beats point tools. Weaker as a
  standalone chatbot (ChatGPT exists); strong as a business-grounded actor.
- **Pricing:** the **anchor of the subscription** (hybrid — see §4).
- **Maintenance:** Medium (LLM cost, prompt upkeep, tool expansion).
- **Target market:** All customers — it's the platform hub.
- **Sell priority:** **#3** strategically **#1** — it's the differentiator;
  lead demos with it even when the paid product is a point agent.

### Speed-to-Lead Agent — 7/10 (now configurable)
- **Problem solved:** response time is the single biggest predictor of lead
  conversion; most SMBs reply hours late. Instant acknowledgment wins.
- **Ideal customer:** any lead-gen SMB; especially higher-value services.
- **Would they pay?** Yes, as a cheap high-ROI add-on. The quantified story
  ("respond in seconds, not hours") sells itself. Now that the message is
  editable it's a real product, not a canned email.
- **Pricing:** **Subscription add-on**, €19–39/mo, or bundled.
- **Maintenance:** Low (one email + log).
- **Target market:** Trades, home services, agencies, anyone running ads.
- **Sell priority:** **#4** — cheapest to run, easiest upsell.

### Content Agent — 6/10 standalone, 8/10 bundled
- **Problem solved:** marketing content is time-consuming; agencies are
  expensive. Grounded in the business's own voice and facts.
- **Ideal customer:** marketing-active SMBs — retail, hospitality, services.
- **Would they pay?** Yes, but the category is **commoditising** (ChatGPT
  does generic copy). The defensible angle is brand-voice grounding + it
  living where their business data is. Sell it bundled, not as a Jasper rival.
- **Pricing:** **Subscription** or **usage-based** (per generation past a cap).
- **Maintenance:** Medium (prompt quality, model cost).
- **Target market:** SMBs doing their own marketing.
- **Sell priority:** **#5** — broad appeal, thinner moat.

### Website Agent — 6/10 (platform glue / entry point)
- **Problem solved:** many micro-businesses have no web presence at all; this
  gives them a hosted page with lead capture in minutes.
- **Ideal customer:** sole traders and new businesses without a website.
- **Would they pay?** Modestly — it competes with Wix/Squarespace/Google
  Business Profile as a builder. Its real value is as the **front door** that
  feeds CRM + Speed-to-Lead. Best sold as the on-ramp, not a Wix rival.
- **Pricing:** **Subscription**, €29–49/mo, or bundled free with 2+ agents.
- **Maintenance:** Low–medium.
- **Target market:** Micro-businesses with no site.
- **Sell priority:** **#6** — acquisition tool more than profit centre.

### CRM Agent — 4/10 standalone, essential as infrastructure
- **Problem solved:** contacts scattered across agents; no single view.
- **Ideal customer:** any SMB accumulating leads/customers.
- **Would they pay standalone?** No — it's a feature, and free CRMs (HubSpot
  free) set the price anchor at zero. But it's the connective tissue that
  makes the other agents feel like one platform.
- **Pricing:** **Bundle only** — include free with any 2+ agents. Never sell
  alone.
- **Maintenance:** Low.
- **Target market:** All bundle customers.
- **Sell priority:** **#7** — never lead with it; use it as a "look, it's all
  in one place" closer.

---

## 4. Recommended pricing & packaging

**Model: Hybrid.** Monthly subscription + one-time setup fee + fair-use
usage caps on the AI-heavy agents.

- **One-time setup (€250–750):** onboarding, load the business knowledge +
  price guide, branding, publish the page. Critical for service SMBs — it
  funds hands-on onboarding and raises perceived value/commitment.
- **Subscription tiers (the core revenue):**
  - **Starter** — AI Assistant + CRM + 1 agent of choice. ~€99/mo.
  - **Growth** — + Review Agent + Speed-to-Lead + Content Agent. ~€199/mo.
  - **Pro** — everything incl. Instant Quote + Website. ~€349/mo.
- **Usage overage:** fair-use caps on Content generations and AI Assistant
  messages; overage billed per unit. Protects margin as LLM usage scales.

Why hybrid: SMBs in this segment expect a setup/onboarding touch, subscription
matches the recurring value, and usage caps stop a heavy Content user from
eroding margin. Pure usage-based would scare non-technical buyers; pure flat
would bleed margin on power users.

---

## 5. Sell-priority order (go-to-market)

1. **Review Agent** — proven category, clearest ROI, lowest maintenance.
2. **Instant Quote Agent** — differentiated, high-ROI for trades.
3. **AI Assistant** — lead every demo with it; it's the "wow" and the moat.
4. **Speed-to-Lead Agent** — cheap, high-ROI upsell attached to any lead flow.
5. **Content Agent** — broad appeal; sell bundled, not as a point tool.
6. **Website Agent** — acquisition on-ramp for no-website businesses.
7. **CRM Agent** — bundle-only closer, never standalone.

---

## 6. What to build next (roadmap, commercially ranked)

The 7 coming-soon agents in `future.ts`, ranked by commercial value vs build
cost — **based on current best practice, not speculation**:

1. **Voice Agent (AI receptionist)** — biggest market and willingness to pay
   in this segment (missed calls = missed revenue for trades). Hardest to
   build (telephony + latency). High risk, high reward.
2. **Proposal Agent** — natural extension of Instant Quote (quote →
   branded PDF proposal). Reuses the quote core; low incremental cost.
3. **Scheduling Agent** — pairs with trades/quotes to close the loop
   (quote → book). Strong retention driver.
4. **Support Agent** — reuses the AI Assistant + business knowledge; low
   build cost, good for retail/hospitality.
5. **Finance Agent (invoicing/chasing)** — real pain, but crosses into
   regulated/accounting territory; more integration risk.
6. **Sales Agent / Operations Agent** — valuable but broad; define a sharp
   wedge before building.

---

## 7. Technical health (for the record)

- **Architecture:** sound. Modular registry, RLS multi-tenancy, swappable
  LLM provider, shared cores. Adding an agent is a checklist, not a project.
- **Security:** RLS on every tenant table; entitlement re-checked in every
  action; service-role client `server-only`-guarded; tenant-isolation tests
  in `supabase/tests/`. No customer can read another's data.
- **Scalability:** shared-schema multi-tenancy is the right pattern to
  thousands of tenants; paginated admin lists; batched per-page queries (no
  N+1).
- **Maintainability:** centralised model config, standardised guards, no dead
  code, consistent error handling. A single model upgrade touches one file.
- **Known follow-ups:** run `manual_update_0006/0007.sql`; add per-message
  LLM cost/usage metering before enabling usage-based billing; add automated
  Playwright coverage for the agent happy-paths.
