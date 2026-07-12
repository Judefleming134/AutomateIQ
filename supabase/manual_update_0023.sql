-- =============================================================================
-- AutomateIQ manual update 0023 — Voice Agent captured jobs
--
-- Run in the Supabase SQL Editor (after 0020). Fully idempotent — safe to
-- re-run. Identical to supabase/migrations/0023_voice_agent_jobs.sql.
--
-- Creates va_jobs: the persisted record of every enquiry the AI receptionist
-- captures on a call. The ElevenLabs post-call webhook already emails a job
-- card; this table stores each one too, so the customer's Voice Agent portal
-- shows a live list of the jobs their receptionist booked — the proof the
-- product is working. Rows are written only by the service-role webhook;
-- customers can view their own jobs but never write them.
-- =============================================================================

create table if not exists va_jobs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  caller_name text not null default '',
  caller_phone text not null default '',
  address text not null default '',
  problem text not null default '',
  urgency text not null default '',
  booking_slot text not null default '',
  summary text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists va_jobs_business_created_idx
  on va_jobs (business_id, created_at desc);

alter table va_jobs enable row level security;

drop policy if exists "members view their own voice jobs" on va_jobs;
create policy "members view their own voice jobs"
  on va_jobs for select
  using (is_active_tenant_member(business_id));
