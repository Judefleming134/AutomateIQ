-- =============================================================================
-- AutomateIQ manual update 0009 — Enterprise Documentation Management System
--
-- A data-driven documentation library: admins author documents and assign
-- them to individual customers or groups; customers see only what they're
-- assigned. Access is enforced by RLS, never only the frontend.
--
-- Reuses existing businesses / profiles / auth. Admin writes via the
-- service-role client (bypasses RLS); customers read via RLS below.
-- Run in the Supabase SQL Editor. Fully idempotent.
-- =============================================================================

-- The documents themselves --------------------------------------------------
create table if not exists doc_documents (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  category text not null default 'General',
  summary text not null default '',
  icon text,
  content text not null default '',
  status text not null default 'draft'
    check (status in ('draft', 'published', 'archived')),
  version integer not null default 1,
  -- When true, every active customer sees it (a standard library doc).
  is_global boolean not null default false,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz
);
create index if not exists doc_documents_browse_idx
  on doc_documents (status, category, sort_order);

-- Immutable version snapshots (created on each publish/save) -----------------
create table if not exists doc_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references doc_documents (id) on delete cascade,
  version integer not null,
  title text not null,
  content text not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id)
);
create index if not exists doc_versions_doc_idx
  on doc_versions (document_id, version desc);

-- Customer groups (assign a document to many businesses at once) -------------
create table if not exists doc_groups (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  description text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists doc_group_members (
  group_id uuid not null references doc_groups (id) on delete cascade,
  business_id uuid not null references businesses (id) on delete cascade,
  primary key (group_id, business_id)
);

-- Per-business and per-group assignments ------------------------------------
create table if not exists doc_assignments (
  document_id uuid not null references doc_documents (id) on delete cascade,
  business_id uuid not null references businesses (id) on delete cascade,
  primary key (document_id, business_id)
);

create table if not exists doc_group_assignments (
  document_id uuid not null references doc_documents (id) on delete cascade,
  group_id uuid not null references doc_groups (id) on delete cascade,
  primary key (document_id, group_id)
);

-- Visibility rule (SECURITY DEFINER so the customer read policy can consult
-- assignment/group tables without exposing them). A document is visible to
-- the caller when it's published AND (global OR directly assigned OR
-- assigned via a group the caller's business belongs to) AND the caller's
-- business is active.
create or replace function doc_visible_to_member(doc uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1
    from doc_documents d
    join profiles p on p.id = (select auth.uid())
    join businesses b on b.id = p.business_id and b.status = 'active'
    where d.id = doc
      and d.status = 'published'
      and (
        d.is_global
        or exists (
          select 1 from doc_assignments a
          where a.document_id = d.id and a.business_id = p.business_id
        )
        or exists (
          select 1 from doc_group_assignments ga
          join doc_group_members gm on gm.group_id = ga.group_id
          where ga.document_id = d.id and gm.business_id = p.business_id
        )
      )
  );
$$;

-- RLS: customers may SELECT only documents visible to them. Admin uses the
-- service-role client, which bypasses RLS entirely.
alter table doc_documents enable row level security;
drop policy if exists "members read assigned published docs" on doc_documents;
create policy "members read assigned published docs"
  on doc_documents for select
  using (doc_visible_to_member(id));

-- The join/version/group tables are admin-only (service role). Enabling RLS
-- with no policy denies all direct access from the authenticated role; the
-- SECURITY DEFINER function above still reads them for the visibility check.
alter table doc_versions enable row level security;
alter table doc_groups enable row level security;
alter table doc_group_members enable row level security;
alter table doc_assignments enable row level security;
alter table doc_group_assignments enable row level security;
