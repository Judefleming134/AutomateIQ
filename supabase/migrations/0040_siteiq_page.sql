-- =============================================================================
-- 0040 — SiteIQ becomes a business page, and can be measured
--
-- The page had a headline, a paragraph, a list of services and a phone
-- number. That is a business card. The three things a person actually looks
-- for on a local business page — are you open, do you cover my area, how do I
-- reach you — were none of them answerable, and a search engine could read
-- none of it either, so the page was a blue link at best.
--
-- This adds the two missing fields (opening hours, areas served) and the
-- thing that makes the whole product provable: a view count.
--
-- WHY VIEWS ARE COUNTED PER DAY, NOT PER VISIT.
--
-- A row per visit on a PUBLIC page is a table anyone on the internet can
-- write to, without a session, as fast as they can hold a key down. It grows
-- without bound and the first thing it costs is the database everything else
-- runs on. A daily counter is one row per page per day forever, and the
-- increment is a single atomic UPDATE that cannot be made to fan out.
--
-- Idempotent. Safe to re-run. Purely additive — every existing page keeps
-- working exactly as it does today, with empty hours and no areas.
-- =============================================================================

alter table wa_pages
  add column if not exists hours jsonb not null default '[]'::jsonb;

alter table wa_pages
  add column if not exists areas jsonb not null default '[]'::jsonb;

-- One row per page per day. `day` is the Irish calendar date, matching every
-- other date in the app.
create table if not exists wa_page_views (
  business_id uuid not null references businesses (id) on delete cascade,
  day date not null,
  views integer not null default 0 check (views >= 0),
  primary key (business_id, day)
);

create index if not exists wa_page_views_day_idx
  on wa_page_views (business_id, day desc);

alter table wa_page_views enable row level security;

-- Read-only through RLS. The public page cannot reach this table with a user
-- session — it has none — so the WRITE happens through the function below,
-- which is the only way a row is ever created or changed.
drop policy if exists "members view their own page views" on wa_page_views;
create policy "members view their own page views"
  on wa_page_views
  for select
  using (is_active_tenant_member (business_id));

-- The entire write surface for view counting, and deliberately the only one.
--
-- SECURITY DEFINER because the caller is an anonymous visitor with no session.
-- It takes a business and a date and adds one. It cannot be made to write any
-- other column, any other table, or any value other than +1 — which is what
-- makes it safe to expose to the public internet.
create or replace function record_page_view (p_business_id uuid, p_day date)
  returns void
  language sql
  security definer
  set search_path = public
  as $$
  insert into wa_page_views (business_id, day, views)
  values (p_business_id, p_day, 1)
  on conflict (business_id, day)
    do update set
      views = wa_page_views.views + 1;
$$;

comment on function record_page_view (uuid, date) is
  'Adds one to a SiteIQ page''s view count for a day. The only write path to wa_page_views: it cannot set an arbitrary value, touch another column, or reach another table, which is what makes it safe to call from an anonymous public page.';

comment on table wa_page_views is
  'Daily view counts for SiteIQ public pages. Per day rather than per visit because a public page is a table the whole internet can write to — this bounds it to one row per page per day.';
