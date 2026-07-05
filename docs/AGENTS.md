# AutomateIQ — Agent Architecture & Standards

This is the engineering reference for how every AI agent in the platform is
built. It exists so that adding agent #12 is a mechanical, low-risk exercise
that follows the same shape as agents #1–11.

## The core idea

Every product is a **module** (`lib/agents/modules/*.ts`) that registers
itself in one place (`lib/agents/registry.ts`). The AI Assistant, the
Products hub, Analytics, and the dashboard all discover modules from the
registry — so a new agent never requires editing the shell, the navigation,
or the assistant.

```
lib/agents/
  types.ts        AgentModule + AgentTool contracts
  registry.ts     AGENT_MODULES list + discovery helpers
  modules/
    platform.ts           always-on cross-module tools
    review-agent.ts        live
    website-agent.ts       live
    content-agent.ts       live
    instant-quote-agent.ts live
    crm-agent.ts           live
    speed-to-lead-agent.ts live
    future.ts              7 coming-soon agents (metadata only)
```

## What a module declares

- **Metadata** — key, name, version, category, description, icon, accent.
- **Availability** — `live` | `coming_soon` | `framework`.
- **Capabilities** — the human-readable selling points (shown on Products).
- **Tools** — the callable functions the AI Assistant can invoke. Each tool
  has a JSON-Schema input, a model-facing description, and an `execute`
  that runs server-side against the **RLS-scoped** Supabase client.

## Standard building blocks (use these — don't re-implement)

| Concern | Use | Notes |
|---|---|---|
| LLM calls | `lib/ai/config.ts` + `lib/ai/complete.ts` | Model IDs, endpoints, provider selection live in one file. `aiComplete()` for single-shot generation; the AI Assistant runs its own tool-calling loop but pulls the same config. |
| Provider strategy | `resolveProvider()` | Claude when `ANTHROPIC_API_KEY` is set, else Gemini free tier. Swapping the model is a one-line change in `config.ts`. |
| Page entitlement guard | `productLayout(key)` or `guardProduct(key)` | `layout.tsx` = `export default productLayout("my-agent");`. Subnav layouts call `await guardProduct("my-agent")`. |
| Server-action entitlement | `requireProductEnabled(businessId, key)` | Re-checked inside **every** action — the security boundary, not just UX. |
| Email | `lib/email/resend.ts` | `getResendClient()` + `getFromAddress()`; always pass an `idempotencyKey`. |
| Tenant isolation | RLS via `is_active_tenant_member(business_id)` | Every tenant table. Never trust a client-supplied `business_id`. |
| Shared business voice | `aa_assistants` (knowledge + tone) | Set in Settings; read by AI Assistant and Content Agent. |

## Adding a new agent — the checklist

1. **Schema** — add tables (prefixed, e.g. `xx_`) + RLS policies to a new
   `supabase/manual_update_00NN.sql` (idempotent; `is_active_tenant_member`
   guards). Add the product row to the same file and to `seed.sql`.
2. **Module** — `lib/agents/modules/my-agent.ts` with metadata + tools;
   register it in `registry.ts`; remove it from `future.ts` if it was there.
3. **Registry tile** — add to `lib/products/registry.ts` (drives the
   dashboard tile + Products hub) and `lib/products/icons.tsx` if new icon.
4. **Portal surface** — `app/portal/my-agent/{layout,page,actions}.tsx`.
   `layout.tsx` = `productLayout("my-agent")`.
5. **Core logic** — if it's shared with an AI Assistant tool, put it in
   `lib/my-agent/*-core.ts` and call it from both the action and the tool
   (see `send-core.ts`, `generate-core.ts`, `create-core.ts`).
6. **Verify** — run the migration chain locally against Postgres with the
   Supabase stub + a tenant-isolation test (see `supabase/tests/`), then
   `tsc` + `next build`.

## Conventions

- Server-only modules start with `import "server-only";`.
- Every external call (LLM, email) is best-effort where the primary write
  already succeeded — a failed side effect must never fail the request.
- Durable record **before** the external call (email/LLM), status update
  after — no silent gaps.
- Errors log with a stable prefix (`console.error("<Agent> <op> failed:", …)`)
  and surface a plain-English message to the user.
- All timestamps rendered `en-IE`.
