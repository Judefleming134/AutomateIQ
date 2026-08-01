-- =============================================================================
-- 0042 — Stop shipping the whole database to render one page
--
-- /growth/prospects is the page Jude lives on. Every single load of it — every
-- page-turn, every search, every filter change — did three FULL TABLE READS
-- whose results are then thrown away almost entirely:
--
--   1. Every prospect's `industry`, to build a <select> of ~32 distinct
--      values. 20,000 rows read to render 32 options.
--   2. Every active prospect (id, company, website, status), to work out which
--      ones still need researching.
--   3. Every row of ge_research, for the same reason.
--
-- At Jude's scale that is ~42,000 rows serialised to JSON, fetched over ~20
-- paged PostgREST requests (selectAllRows pages at 1,000), and reduced in Node
-- to a 32-item dropdown and a 300-row queue.
--
-- Postgres was never the slow part — it answers all three in under 10ms. The
-- cost is the transfer and the parse, and the fix is to ask Postgres the
-- question we actually have instead of asking for everything and filtering
-- afterwards. Same answers, 332 rows instead of 42,001.
--
-- SECURITY INVOKER is not optional here. A view without it runs with the
-- OWNER's rights, which would let it read straight past the row-level security
-- on ge_prospects for whoever queries it. With it, the view is exactly as
-- privileged as the caller already was.
--
-- Idempotent. Safe to re-run. Purely additive — nothing reads these until the
-- code does, and the code falls back to the old path if they are absent.
-- =============================================================================

-- Supports the DISTINCT below, and the industry filter on the page itself.
create index if not exists ge_prospects_industry_idx
  on ge_prospects (industry)
  where industry is not null;

-- The anti-join's inner side.
create index if not exists ge_research_prospect_idx
  on ge_research (prospect_id);

-- ---------------------------------------------------------------------------
-- The industries actually in use, for the filter dropdown.
-- ---------------------------------------------------------------------------
create or replace view ge_prospect_industries
with (security_invoker = true) as
select distinct
  btrim(industry) as industry
from
  ge_prospects
where
  industry is not null
  and btrim(industry) <> ''
order by
  1;

comment on view ge_prospect_industries is
  'Distinct non-empty industries, for the Prospects filter dropdown. Replaces reading every prospect''s industry column to compute the same ~32 values in Node.';

-- ---------------------------------------------------------------------------
-- Prospects that still need researching.
--
-- Includes research_failed rows and exposes `status`, so the page can split
-- the fresh queue from the retry group with a filter rather than a second
-- full read. `has_website` is materialised because PostgREST can only order
-- by a column, and website-first is the ordering that matters — the engine
-- reads the site, so a lead with one researches far better.
-- ---------------------------------------------------------------------------
create or replace view ge_unresearched_prospects
with (security_invoker = true) as
select
  p.id,
  p.company,
  p.website,
  p.status,
  p.lead_score,
  p.created_at,
  (p.website is not null and btrim(p.website) <> '') as has_website
from
  ge_prospects p
where
  p.status not in ('won', 'lost', 'do_not_contact', 'archived')
  and not exists (
    select 1 from ge_research r where r.prospect_id = p.id
  );

comment on view ge_unresearched_prospects is
  'Active prospects with no ge_research row yet, including research_failed. Replaces reading every active prospect AND every research row into Node to compute the difference there. Query it with an exact count to get the batch and the total in one request.';
