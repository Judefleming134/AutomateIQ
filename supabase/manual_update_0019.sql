-- =============================================================================
-- AutomateIQ manual update 0019 — Voice Agent (AI receptionist portal surface)
--
-- Run in the Supabase SQL Editor (after 0018). Fully idempotent — safe to
-- re-run. Identical to supabase/migrations/0019_voice_agent.sql.
--
-- Creates the customer-facing control surface for the Voice Agent:
--   va_config  — one row per business: live/paused status, the number, and
--                the editable knowledge base the agent answers from.
--   va_tickets — "log a problem" support requests the customer raises.
-- The agent itself runs on ElevenLabs + Twilio; these tables are what the
-- customer sees and edits in the portal. Also lists the Voice Agent in the
-- product catalog so it can be enabled per business.
-- =============================================================================

create table if not exists va_config (
  business_id uuid primary key references businesses (id) on delete cascade,
  status text not null default 'provisioning'
    check (status in ('provisioning', 'live', 'paused')),
  phone_number text,
  greeting text not null default '',
  services text not null default '',
  business_hours text not null default '',
  service_area text not null default '',
  knowledge text not null default '',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists va_tickets (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  subject text not null,
  detail text not null default '',
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'resolved')),
  created_at timestamptz not null default now()
);

create index if not exists va_tickets_business_created_idx
  on va_tickets (business_id, created_at desc);

alter table va_config enable row level security;

drop policy if exists "members manage their own voice config" on va_config;
create policy "members manage their own voice config"
  on va_config for all
  using (is_active_tenant_member(business_id))
  with check (is_active_tenant_member(business_id));

alter table va_tickets enable row level security;

-- Customers may raise tickets and see their own, but not rewrite them —
-- status transitions happen through the service-role admin client.
drop policy if exists "members view their own voice tickets" on va_tickets;
create policy "members view their own voice tickets"
  on va_tickets for select
  using (is_active_tenant_member(business_id));

drop policy if exists "members raise their own voice tickets" on va_tickets;
create policy "members raise their own voice tickets"
  on va_tickets for insert
  with check (is_active_tenant_member(business_id));

-- Product catalog: the Voice Agent is now shipped code, not a placeholder.
insert into products (key, name, description, icon_name, status)
values (
  'voice-agent',
  'Voice Agent',
  'An AI receptionist that answers missed calls, books jobs and texts you the details.',
  'mic',
  'active'
)
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description,
  icon_name = excluded.icon_name,
  status = excluded.status;
