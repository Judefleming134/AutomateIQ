-- Voice Agent jobs (va_jobs) — the record of every enquiry the AI receptionist
-- captured on a call. The ElevenLabs post-call webhook already emails Jude a
-- job card; this table also PERSISTS each one so the customer's portal can show
-- a living list of jobs their receptionist booked — the proof the product is
-- earning its keep, not just a config screen.
--
-- Same conventions as 0019: va_ prefix, business_id on every row, RLS via
-- is_active_tenant_member(). Idempotent — safe to re-run.

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

-- Customers see their own captured jobs; rows are only ever written by the
-- service-role admin client from the post-call webhook, never by the customer.
drop policy if exists "members view their own voice jobs" on va_jobs;
create policy "members view their own voice jobs"
  on va_jobs for select
  using (is_active_tenant_member(business_id));
