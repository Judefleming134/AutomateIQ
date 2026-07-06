-- =============================================================================
-- AutomateIQ manual update 0016 — Logistics live tracking + GPS ingest
--
-- Makes the Logistics Control Centre self-running: a per-business live
-- simulation flag drives vehicle movement on the map now, while a per-business
-- ingest token secures the GPS ingest API for plugging in real providers
-- (Samsara, Geotab, Traccar, …) later. Additive only.
--
-- Run in the Supabase SQL Editor. Fully idempotent.
-- =============================================================================

create table if not exists log_settings (
  business_id uuid primary key references businesses (id) on delete cascade,
  -- Secret used by GPS providers to POST positions to /api/logistics/gps.
  ingest_token text not null default replace(gen_random_uuid()::text, '-', ''),
  -- When on, the platform moves simulated vehicles by itself (no GPS needed).
  live_sim boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table log_settings enable row level security;
drop policy if exists "members manage their own logistics settings" on log_settings;
create policy "members manage their own logistics settings"
  on log_settings for all
  using (is_active_tenant_member(business_id))
  with check (is_active_tenant_member(business_id));
