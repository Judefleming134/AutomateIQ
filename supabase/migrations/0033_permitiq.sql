-- ---------------------------------------------------------------------------
-- PermitIQ — planning permission and building permit workflows.
--
-- Built on `businesses`, the tenancy root that already carries RLS,
-- entitlements, billing and admin tooling. This is deliberate and it is the
-- one architectural rule PermitIQ must not break: the platform already has
-- THREE tenancy roots (businesses, trades_accounts, and the un-scoped ge_*
-- tables) and a fourth would make consolidating them permanently impossible.
--
-- Two design decisions worth stating, because everything else follows:
--
-- 1. JURISDICTION IS A FIRST-CLASS COLUMN, not a later retro-fit. Ireland
--    ships seeded and sellable; the USA ships with the same schema and an
--    honest empty state. Retro-fitting it after Irish customers had data would
--    be a migration on live rows.
--
-- 2. REQUIREMENTS ARE A DATA CATALOG, NOT CODE. What a given authority wants
--    for a given application type is rows in pq_requirements, so adding a US
--    municipality — or fixing an Irish rule that changed — is a seed insert,
--    not a release. Hard-coding Irish planning rules would mean the American
--    half of the product is a second build.
--
-- Additive throughout: no existing table is altered, nothing is dropped.
-- ---------------------------------------------------------------------------

-- ── The requirements catalog ───────────────────────────────────────────────
-- Global reference data, NOT tenant-scoped: every tenant applying in Fingal
-- faces the same list. Readable by any signed-in user; writable only by the
-- service role, so a tenant can never edit the rules they're measured against.
create table if not exists pq_requirements (
  id uuid primary key default gen_random_uuid(),
  jurisdiction text not null check (jurisdiction in ('ie', 'us')),
  -- Null authority = the national/default baseline for that application type.
  -- A specific authority's row overrides it.
  authority text,
  application_type text not null,
  -- Stable machine code, e.g. 'site_location_map'. Referenced by checklist
  -- rows, so it must not change once seeded.
  code text not null,
  label text not null,
  guidance text,
  mandatory boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  -- NULLS NOT DISTINCT is doing real work here. `authority` is null for the
  -- national baseline rows, and under Postgres's default two nulls are NOT
  -- equal — so the unique constraint would not fire, ON CONFLICT below would
  -- never match, and re-running this migration would silently duplicate every
  -- baseline requirement. Every application's checklist would then show each
  -- item twice. (Postgres 15+; Supabase is on 15/16.)
  unique nulls not distinct (jurisdiction, authority, application_type, code)
);

create index if not exists pq_requirements_lookup_idx
  on pq_requirements (jurisdiction, application_type, authority);

alter table pq_requirements enable row level security;

drop policy if exists "signed-in users read the requirements catalog" on pq_requirements;
create policy "signed-in users read the requirements catalog"
  on pq_requirements for select
  to authenticated
  using (true);

-- ── Applications ───────────────────────────────────────────────────────────
create table if not exists pq_applications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  -- The applicant's own reference (a job number, a client name).
  reference text,
  jurisdiction text not null default 'ie' check (jurisdiction in ('ie', 'us')),
  authority text,
  application_type text not null,
  site_address text,
  -- Eircode in Ireland, ZIP in the US. One column, deliberately unvalidated:
  -- two postal-code formats and a check constraint is how you end up unable to
  -- save a legitimate address.
  postal_code text,
  applicant_name text,
  applicant_email text,
  status text not null default 'draft'
    check (status in ('draft', 'in_review', 'submitted', 'granted', 'refused', 'withdrawn')),
  submitted_at timestamptz,
  decision_due_at date,
  notes text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pq_applications_business_idx
  on pq_applications (business_id, created_at desc);
create index if not exists pq_applications_status_idx
  on pq_applications (business_id, status);

alter table pq_applications enable row level security;

drop policy if exists "members manage their own applications" on pq_applications;
create policy "members manage their own applications"
  on pq_applications for all
  using (is_active_tenant_member(business_id))
  with check (is_active_tenant_member(business_id));

-- ── Documents ──────────────────────────────────────────────────────────────
-- business_id is carried alongside application_id on purpose. It is
-- denormalised, and it means every RLS policy is a direct predicate on this
-- row rather than a join through pq_applications — the same shape the rest of
-- the platform uses, and one less way for a policy to be written wrong.
create table if not exists pq_documents (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references pq_applications (id) on delete cascade,
  business_id uuid not null references businesses (id) on delete cascade,
  -- Which requirement this satisfies, when known. Free text rather than a
  -- foreign key: an uploaded document may not map to any catalog row, and a
  -- retired requirement must not cascade-delete a customer's file record.
  doc_type text,
  name text not null,
  storage_path text not null,
  content_type text,
  file_size bigint,
  page_count integer,
  -- What the Document Intelligence Agent read out of it. Null until analysed.
  extraction jsonb,
  extracted_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists pq_documents_application_idx
  on pq_documents (application_id, created_at desc);

alter table pq_documents enable row level security;

drop policy if exists "members manage their own permit documents" on pq_documents;
create policy "members manage their own permit documents"
  on pq_documents for all
  using (is_active_tenant_member(business_id))
  with check (is_active_tenant_member(business_id));

-- ── Per-application checklist state ────────────────────────────────────────
create table if not exists pq_application_requirements (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references pq_applications (id) on delete cascade,
  business_id uuid not null references businesses (id) on delete cascade,
  -- The catalog code, copied not referenced: an application's checklist is a
  -- record of what was asked at the time, and editing the catalog later must
  -- not rewrite the history of a submitted application.
  requirement_code text not null,
  label text not null,
  status text not null default 'missing'
    check (status in ('satisfied', 'missing', 'unclear', 'not_applicable')),
  evidence_document_id uuid references pq_documents (id) on delete set null,
  notes text,
  -- Who decided: the agent or a person. A reviewer overriding the AI must be
  -- visible as an override, not silently indistinguishable from it.
  source text not null default 'ai' check (source in ('ai', 'human')),
  updated_at timestamptz not null default now(),
  unique (application_id, requirement_code)
);

create index if not exists pq_app_requirements_app_idx
  on pq_application_requirements (application_id);

alter table pq_application_requirements enable row level security;

drop policy if exists "members manage their own checklists" on pq_application_requirements;
create policy "members manage their own checklists"
  on pq_application_requirements for all
  using (is_active_tenant_member(business_id))
  with check (is_active_tenant_member(business_id));

-- ── AI review runs ─────────────────────────────────────────────────────────
create table if not exists pq_reviews (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references pq_applications (id) on delete cascade,
  business_id uuid not null references businesses (id) on delete cascade,
  agent_key text not null,
  summary text,
  risk_flags jsonb not null default '[]'::jsonb,
  model text,
  created_at timestamptz not null default now()
);

create index if not exists pq_reviews_application_idx
  on pq_reviews (application_id, created_at desc);

alter table pq_reviews enable row level security;

drop policy if exists "members read their own reviews" on pq_reviews;
create policy "members read their own reviews"
  on pq_reviews for all
  using (is_active_tenant_member(business_id))
  with check (is_active_tenant_member(business_id));

-- ── Reviewer notes ─────────────────────────────────────────────────────────
create table if not exists pq_notes (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references pq_applications (id) on delete cascade,
  business_id uuid not null references businesses (id) on delete cascade,
  body text not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists pq_notes_application_idx
  on pq_notes (application_id, created_at desc);

alter table pq_notes enable row level security;

drop policy if exists "members manage their own notes" on pq_notes;
create policy "members manage their own notes"
  on pq_notes for all
  using (is_active_tenant_member(business_id))
  with check (is_active_tenant_member(business_id));

-- ── Audit history ──────────────────────────────────────────────────────────
-- Append-only by policy: members can SELECT and INSERT, and there is
-- deliberately no update or delete policy. An audit trail a tenant can rewrite
-- is not an audit trail, and "audit history" is an explicit requirement of the
-- reviewer surface.
--
-- How it holds is worth knowing before someone "fixes" it: a missing policy
-- does NOT raise an error on UPDATE or DELETE. Postgres simply finds no rows
-- visible for the operation, so the statement succeeds and reports 0 rows
-- affected. Verified on scratch PG16 by counting rows either side rather than
-- by watching for an exception — a tenant's UPDATE and DELETE both returned 0
-- and every row was left byte-identical.
create table if not exists pq_events (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references pq_applications (id) on delete cascade,
  business_id uuid not null references businesses (id) on delete cascade,
  type text not null,
  detail text,
  actor uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists pq_events_application_idx
  on pq_events (application_id, created_at desc);

alter table pq_events enable row level security;

drop policy if exists "members read their own audit history" on pq_events;
create policy "members read their own audit history"
  on pq_events for select
  using (is_active_tenant_member(business_id));

drop policy if exists "members append to their own audit history" on pq_events;
create policy "members append to their own audit history"
  on pq_events for insert
  with check (is_active_tenant_member(business_id));

-- ── Private storage for the drawings and reports ───────────────────────────
-- Same pattern as the existing `documents` bucket: no storage.objects policies
-- at all, so anon/authenticated get no direct storage access and only the
-- service-role client (server-side, after an RLS-scoped ownership check)
-- issues short-lived signed URLs.
insert into storage.buckets (id, name, public)
values ('permits', 'permits', false)
on conflict (id) do nothing;

-- ── Product registry row ───────────────────────────────────────────────────
-- 'coming_soon' until the applicant surface ships. The key is permanent from
-- this moment: business_products joins on it, so it can never be renamed.
insert into products (key, name, description, icon_name, status)
values (
  'permitiq',
  'PermitIQ',
  'Planning permission and building permit workflows — upload the documents, get a checklist, a summary and the gaps before you submit.',
  'file-check',
  'coming_soon'
)
on conflict (key) do nothing;

-- ── Starter catalog: Ireland ───────────────────────────────────────────────
-- A national baseline (authority = null) for the two most common application
-- types. Deliberately a STARTING POINT, not a claim of completeness — a real
-- authority's list is seeded per authority and overrides these. Idempotent via
-- the unique constraint.
insert into pq_requirements
  (jurisdiction, authority, application_type, code, label, guidance, mandatory, sort_order)
values
  ('ie', null, 'planning_permission', 'site_location_map', 'Site location map',
   'Ordnance Survey based, typically 1:2500 in urban areas or 1:10560 rural, with the site outlined in red and any adjoining land in the applicant''s control in blue.', true, 10),
  ('ie', null, 'planning_permission', 'site_layout_plan', 'Site layout plan',
   'Usually 1:500. Shows the proposed development in context: boundaries, existing structures, access, parking and drainage.', true, 20),
  ('ie', null, 'planning_permission', 'floor_plans', 'Floor plans, elevations and sections',
   'Typically 1:100. Existing and proposed, with all elevations affected by the works.', true, 30),
  ('ie', null, 'planning_permission', 'public_notice_newspaper', 'Newspaper notice',
   'Published in an approved newspaper within two weeks before the application is lodged. The original page is normally required.', true, 40),
  ('ie', null, 'planning_permission', 'public_notice_site', 'Site notice',
   'Erected on the site on or before the day of application and maintained for five weeks. A photograph and the notice text are usually required.', true, 50),
  ('ie', null, 'planning_permission', 'application_form', 'Completed application form',
   'The planning authority''s own form, signed and dated.', true, 60),
  ('ie', null, 'planning_permission', 'fee', 'Application fee',
   'Set by the planning authority and varies by development type and scale.', true, 70),
  ('ie', null, 'planning_permission', 'wastewater_assessment', 'Site characterisation / wastewater assessment',
   'Required where the development is not connecting to a public sewer. Usually an EPA-code site assessment by a qualified assessor.', false, 80),
  ('ie', null, 'planning_permission', 'flood_risk_assessment', 'Flood risk assessment',
   'Required where the site is in or near a flood risk zone.', false, 90),
  ('ie', null, 'retention_permission', 'application_form', 'Completed retention application form',
   'The planning authority''s retention form, signed and dated.', true, 10),
  ('ie', null, 'retention_permission', 'site_location_map', 'Site location map',
   'As for a standard application, showing the structure or works already carried out.', true, 20),
  ('ie', null, 'retention_permission', 'as_built_drawings', 'As-built drawings',
   'Plans, elevations and sections of the development as actually constructed, not as originally intended.', true, 30),
  ('ie', null, 'retention_permission', 'public_notice_newspaper', 'Newspaper notice',
   'Must state that the application is for RETENTION of the development.', true, 40),
  ('ie', null, 'retention_permission', 'public_notice_site', 'Site notice',
   'Must state that the application is for RETENTION of the development.', true, 50)
on conflict (jurisdiction, authority, application_type, code) do nothing;

comment on table pq_requirements is
  'What a jurisdiction/authority requires for an application type. Global reference data: readable by any signed-in user, writable only by the service role.';
comment on table pq_events is
  'Append-only audit history per application. Members can select and insert; no update or delete policy exists on purpose.';
