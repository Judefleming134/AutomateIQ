-- =============================================================================
-- AutomateIQ Platform — database update 0006 (customer Documents)
-- Run ONCE in the Supabase SQL Editor. Idempotent — safe to re-run.
-- =============================================================================

begin;
-- Customer documents (contracts, paperwork). Files live in a private
-- Supabase Storage bucket; this table is the per-business index of them.
-- All writes (upload/delete) happen through admin-gated server actions
-- using the service-role client; customers get read-only access to their
-- own rows via RLS, and downloads are short-lived signed URLs generated
-- server-side after an RLS-scoped ownership check.

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  name text not null,
  storage_path text not null,
  file_size bigint,
  content_type text,
  created_at timestamptz not null default now()
);

create index if not exists documents_business_created_idx
  on documents (business_id, created_at desc);

alter table documents enable row level security;

drop policy if exists "members view their own documents" on documents;
create policy "members view their own documents"
  on documents for select
  using (is_active_tenant_member(business_id));

-- Private bucket for the files themselves. No storage.objects policies on
-- purpose: anon/authenticated get no direct storage access at all — only
-- the service-role client (server-side) touches the bucket.
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;
commit;
