-- ---------------------------------------------------------------------------
-- Agent Framework v2: the run log.
--
-- The agent framework declares what each agent IS (name, purpose, tools) but
-- kept no record of what any agent DID. There was no way to answer "did that
-- actually run?", "how slow is the quote agent?", or "which tool keeps
-- failing?" — for eleven live agents, let alone the five PermitIQ ones.
--
-- One row per tool execution. This single table delivers both attributes the
-- platform brief asks for — Logs and Performance tracking — for every agent at
-- once, rather than each module inventing its own telemetry.
--
-- Deliberately NOT stored here: tool input and output. They routinely contain
-- customer names, email addresses and quote figures, and a debug log is the
-- wrong place for personal data to accumulate. The row records that a call
-- happened, how it went and how long it took; the business data stays in the
-- module's own tables where RLS already governs it.
--
-- Writes go through the service-role client (same pattern as admin_audit_log)
-- and are best-effort: a logging failure must never fail the tool it describes.
-- Members can READ their own rows; there is no insert/update/delete policy, so
-- nothing but the service role can write, and nobody can rewrite history.
-- ---------------------------------------------------------------------------

create table if not exists agent_runs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  -- Matches AgentModule.key. Plain text, not a foreign key: modules live in
  -- code and a renamed or retired agent must not cascade-delete its history.
  agent_key text not null,
  tool_name text not null,
  status text not null check (status in ('ok', 'error', 'timeout', 'denied')),
  latency_ms integer check (latency_ms >= 0),
  -- Short failure reason, never a stack trace or a payload.
  error text,
  created_at timestamptz not null default now()
);

-- The two reads this table exists to serve: one business's recent activity,
-- and one agent's performance across the platform.
create index if not exists agent_runs_business_created_idx
  on agent_runs (business_id, created_at desc);
create index if not exists agent_runs_agent_created_idx
  on agent_runs (agent_key, created_at desc);

alter table agent_runs enable row level security;

drop policy if exists "members view their own agent runs" on agent_runs;
create policy "members view their own agent runs"
  on agent_runs for select
  using (is_active_tenant_member(business_id));

comment on table agent_runs is
  'One row per agent tool execution: logs + performance tracking for every module. Service-role writes only; no tool input/output is stored.';
