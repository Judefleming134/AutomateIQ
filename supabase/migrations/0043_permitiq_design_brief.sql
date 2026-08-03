-- ---------------------------------------------------------------------------
-- PermitIQ — the design brief behind the generated drawings and form pack.
--
-- ONE TABLE, AND DELIBERATELY NOT TWO.
--
-- The obvious schema here is a briefs table plus a drawings table holding the
-- generated SVGs. There is no drawings table, because the drawings are a PURE
-- FUNCTION of the brief: lib/permitiq/design/sheets.ts is deterministic and
-- takes its date from its caller, so the same brief renders byte-identically
-- for ever. Storing the output would buy nothing and cost the one thing that
-- actually matters — a stored drawing can drift out of step with the brief it
-- came from, and then the sheet in the file and the sheet on screen disagree
-- about a building. Render on read; there is nothing to go stale.
--
-- That is also why `drawing_date` is a stored column rather than current_date
-- at render time. It is fixed when the brief is first saved so a set printed
-- in September is identical to the set printed in August, which is what makes
-- a drawing re-checkable after a request for further information.
--
-- Built on `businesses` like the rest of PermitIQ (see 0033) — no fourth
-- tenancy root. Additive throughout: nothing existing is altered or dropped.
-- ---------------------------------------------------------------------------

create table if not exists pq_design_briefs (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references pq_applications (id) on delete cascade,
  business_id uuid not null references businesses (id) on delete cascade,

  -- The whole DesignBrief, as the questionnaire captured it. jsonb rather than
  -- forty columns: the brief's shape belongs to the drawing code, which is
  -- versioned in the repo and tested, and pinning it into columns would make
  -- every future question a migration on live rows.
  brief jsonb not null,

  -- Frozen at first save. See the note above on why this is not current_date.
  drawing_date date not null default current_date,

  -- Fields the form pack needs that are not part of the geometry.
  project_name text,
  applicant_name text,
  applicant_address text,
  applicant_email text,
  applicant_phone text,
  agent_name text,
  agent_address text,
  interest_in_land text,
  authority text,
  newspaper text,
  intended_application_date date,

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One brief per application. The drawings and the form pack are two views of
  -- the same answers, so a second brief on the same application would mean an
  -- application whose form and drawings could describe different buildings —
  -- the exact contradiction the form pack exists to prevent.
  unique (application_id)
);

create index if not exists pq_design_briefs_business_idx
  on pq_design_briefs (business_id, updated_at desc);

alter table pq_design_briefs enable row level security;

-- Same tenancy rule as every other pq_ table (0033): membership of the owning
-- business, checked on read AND write, so a brief cannot be written into
-- another tenant's application.
drop policy if exists "tenant members manage their design briefs" on pq_design_briefs;
create policy "tenant members manage their design briefs"
  on pq_design_briefs for all
  using (is_active_tenant_member(business_id))
  with check (is_active_tenant_member(business_id));
