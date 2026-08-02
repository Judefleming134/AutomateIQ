-- =====================================================================
-- AutomateIQ — pending migrations 0035 to 0042, in one paste.
--
-- WHAT THIS IS
--   The eight migrations that have been written, validated and merged but
--   never run against production. Each one was validated on a scratch
--   Postgres 16 by attempting to break every guard it adds; each is
--   idempotent, so running this twice is safe and running it after having
--   run some of them individually is also safe.
--
-- HOW TO RUN IT
--   Supabase dashboard -> SQL Editor -> New query -> paste the whole file
--   -> Run. It executes top to bottom in one go. Takes a few seconds.
--
-- WHAT IT DOES NOT DO
--   Nothing here drops, renames or rewrites an existing column, table or
--   row. Every statement is CREATE ... IF NOT EXISTS, ADD COLUMN IF NOT
--   EXISTS, or CREATE OR REPLACE. Existing data is untouched.
--
-- WHAT TURNS ON WHEN IT FINISHES
--   0035  booking IP guard        stops one script booking unlimited slots
--   0036  harvest attempt         Jarvis stops re-reading the same dead
--                                 domains every night and never reaching
--                                 the ninth prospect
--   0037  invoices                QuoteIQ invoicing — the thing the TradeIQ
--                                 page sells and that did not exist
--   0038  invoice chasing         automatic overdue chasing (needs 0037)
--   0039  content sends           ContentIQ "publish" actually emails the
--                                 piece instead of setting a status
--   0040  siteiq page             opening hours, areas covered, and daily
--                                 view counts on published pages
--   0041  review autopilot        marking an invoice paid queues the review
--                                 request for the next 07:00 run, opt-in and
--                                 default OFF (needs 0037)
--   0042  prospect views          /growth/prospects reads 347 rows in 3
--                                 requests instead of 42,011 in 55
--
--   Order matters: 0037 before 0038 and 0041. This file is already in order.
--
-- IF SOMETHING GOES WRONG
--   Every feature above degrades safely without its migration and each app
--   path checks for its own table before using it, so a partial run leaves
--   the site working — it just leaves the un-migrated features switched off.
--   The whole file is wrapped in a single transaction, so an error part-way
--   rolls the lot back rather than leaving half of it applied.
--
-- VALIDATED (2026-08-02, scratch Postgres 16, migrations 0001-0034 applied
-- first, then seeded with 50 businesses, 2,000 prospects, 400 quotes, 300
-- bookings, 120 content rows and 900 CRM contacts):
--   · applies clean in one transaction; running the identical paste a second
--     time also succeeds and changes nothing
--   · creates 3 tables (qa_invoices, ca_sends, wa_page_views), 2 views and
--     10 columns on existing tables
--   · every seeded row survives untouched, and every new column reads as
--     never-set — no invoice chased, no content sent, no booking with an IP
--     hash, and every business opted OUT of review requests
--   · security_invoker=true confirmed on both new views (without it they
--     would read past RLS on ge_prospects)
--   · guards proven by ATTEMPTING TO BREAK THEM, each rejected by name while
--     the equivalent valid statement was accepted: negative invoice amount,
--     bad invoice status, a second invoice for the same quote, a duplicate
--     invoice number inside one business (the same number in a DIFFERENT
--     business is allowed, and was), negative page-view count, bad ca_sends
--     status, a case-variant duplicate send (Mary@Example.IE vs
--     mary@example.ie), and a null auto_review_requests
--
-- ONE THING WORTH KNOWING
--   Four tables these migrations touch — strategy_bookings, ca_content,
--   crm_contacts and qa_quotes — exist in production but are created by NO
--   migration in this repo. They had to be stubbed by hand to validate this
--   bundle. That is schema drift, it is logged in docs/OUTSTANDING.md, and it
--   does not affect this paste: in production those tables are already there.
-- =====================================================================

begin;


-- ---------------------------------------------------------------------
-- 0035_booking_ip_guard.sql
-- ---------------------------------------------------------------------

-- =============================================================================
-- 0035 — Per-IP abuse guard for the public booking endpoint
--
-- OUTSTANDING K5. /api/book already limits three bookings per EMAIL per day,
-- and that guard does real work — but a script that varies the address walks
-- straight past it. Every accepted booking holds a calendar slot AND sends two
-- emails, one of them to whatever address the caller typed. Unbounded, that is
-- a way to fill the calendar so genuine prospects cannot book, and to burn the
-- sending domain's reputation on third parties.
--
-- WHY A HASH RATHER THAN THE ADDRESS. The only thing this column is for is
-- counting "how many bookings came from the same origin today". That does not
-- need a raw IP, which is personal data under GDPR and would sit in the table
-- indefinitely. A salted SHA-256 counts identically and cannot be read back.
-- Set BOOKING_IP_SALT in the environment to make it genuinely irreversible;
-- without it the code falls back to a constant salt, which still de-identifies
-- the column at rest but is brute-forceable across the IPv4 space by anyone
-- holding the database. See app/api/book/route.ts.
--
-- Nullable on purpose: every booking already in the table predates this, and
-- a request that arrives with no usable client address must still be able to
-- book. Absence means "unknown", never "blocked".
--
-- Idempotent. Safe to re-run.
-- =============================================================================

alter table strategy_bookings
  add column if not exists created_ip_hash text;

-- The guard's only query: count rows for one hash inside a 24-hour window.
-- Partial, because rows with no hash are never counted and there is no reason
-- to carry them in the index.
create index if not exists strategy_bookings_ip_hash_idx
  on strategy_bookings (created_ip_hash, created_at desc)
  where created_ip_hash is not null;

comment on column strategy_bookings.created_ip_hash is
  'Salted SHA-256 of the requesting IP, for per-origin abuse counting only. Never a raw address. Null for bookings made before 0035, and for requests with no usable client address.';

-- ---------------------------------------------------------------------
-- 0036_harvest_attempt.sql
-- ---------------------------------------------------------------------

-- =============================================================================
-- 0036 — Record when Jarvis last tried to harvest a prospect's contact details
--
-- OUTSTANDING K8. The nightly contact harvest takes the top 8 prospects by
-- lead_score that have a website and no email, and reads their sites. Nothing
-- recorded that an attempt had happened.
--
-- So if those eight have permanently dead domains — parked, expired, blocking
-- bots — the job re-reads the same eight every single night, harvests nothing,
-- reports 0, and NEVER REACHES THE NINTH. No error, no progress, no signal.
-- The ninth prospect could have a working site and a published email sitting
-- there for months. It is the same "score-ordered cap applied before the still
-- to work filter" shape this codebase keeps hitting, except the filter here is
-- "haven't already failed on this one".
--
-- One nullable timestamp fixes it: order by attempt time (nulls first, so
-- never-tried always wins), and stamp it on every attempt whether or not
-- anything was found. The eight dead domains fall to the back of the queue and
-- the rest of the list finally gets read.
--
-- Nullable on purpose: every existing prospect predates this, and NULL is
-- exactly the right meaning — "never attempted", which sorts first.
--
-- Idempotent. Safe to re-run. Purely additive: no existing column, index,
-- constraint or row is altered.
-- =============================================================================

alter table ge_prospects
  add column if not exists last_harvest_attempt_at timestamptz;

-- The harvest's only query: among prospects with a website and no email, find
-- the least-recently-attempted. Partial, because a prospect that already has an
-- email is never a candidate and there is no reason to carry it in the index.
create index if not exists ge_prospects_harvest_attempt_idx
  on ge_prospects (last_harvest_attempt_at nulls first, lead_score desc)
  where email is null and website is not null;

comment on column ge_prospects.last_harvest_attempt_at is
  'When the Jarvis nightly contact harvest last READ this prospect''s website, successful or not. Null = never attempted, which sorts first. Stamped on every attempt so eight dead domains cannot monopolise the nightly batch forever (OUTSTANDING K8).';

-- ---------------------------------------------------------------------
-- 0037_invoices.sql
-- ---------------------------------------------------------------------

-- =============================================================================
-- 0037 — Invoices. The half of QuoteIQ that was sold but never built.
--
-- /products/tradeiq says, in as many words: "Quotes become invoices in one
-- step, with online card payment on the link" and "Chasing is automatic rather
-- than a job for a Sunday evening."
--
-- There was no invoice anywhere in the product. A quote could be created,
-- sent, viewed and accepted — and then the trail stopped. The customer had
-- agreed to pay and the platform had no way to ask them for the money. The
-- trades_* tables are a separate TradeOS schema and are not reachable from
-- QuoteIQ, so nothing filled the gap.
--
-- This is the table behind: accept a quote -> raise the invoice in one step ->
-- send it -> the customer opens a public page -> it is marked paid, and the
-- CRM records the money.
--
-- DESIGN NOTES
--
-- * `amount_cents` is an INTEGER, unlike qa_quotes.total which is free TEXT.
--   A quote total is a human sentence ("from EUR 900"); an invoice is a demand
--   for an exact sum and must never be stored as prose. The conversion parses
--   the quote text once, at creation, and anything unparseable forces the
--   number to be typed rather than guessed.
-- * `number` is per-business and human-facing ("INV-0007"). Unique per
--   business so two customers never receive the same reference, which is both
--   confusing and an accounting problem.
-- * `view_token` mirrors qa_quotes: an unguessable uuid is the customer's key
--   to a public page, so no login is needed to view or pay.
-- * Money is never deleted. `status` moves draft -> sent -> paid, or -> void.
--   There is no DELETE path in the app: voiding leaves the record and the
--   audit trail intact, which is what an invoice is for.
--
-- Idempotent. Safe to re-run. Purely additive — creates one new table and
-- touches nothing that already exists.
-- =============================================================================

create table if not exists qa_invoices (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  -- The quote it came from, when it came from one. Nullable so an invoice can
  -- also be raised directly for work that never had a formal quote.
  quote_id uuid references qa_quotes (id) on delete set null,
  number text not null,
  customer_name text not null,
  customer_email text,
  -- Same shape as qa_quotes.quote_lines: [{ item, price }]
  lines jsonb not null default '[]'::jsonb,
  amount_cents integer not null default 0 check (amount_cents >= 0),
  currency text not null default 'EUR',
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'paid', 'void')),
  notes text not null default '',
  due_date date,
  view_token uuid not null default gen_random_uuid(),
  sent_at timestamptz,
  paid_at timestamptz,
  -- What was actually received. A part payment is real life; it must not be
  -- silently rounded up to the invoice total.
  paid_amount_cents integer check (paid_amount_cents >= 0),
  created_at timestamptz not null default now()
);

-- The customer's key to the public page. Unique so a token identifies exactly
-- one invoice.
create unique index if not exists qa_invoices_view_token_idx
  on qa_invoices (view_token);

-- Human reference, unique within a business.
create unique index if not exists qa_invoices_business_number_idx
  on qa_invoices (business_id, number);

-- The list view: newest first for one business.
create index if not exists qa_invoices_business_created_idx
  on qa_invoices (business_id, created_at desc);

-- The chase query: what is sent, unpaid and past its due date.
create index if not exists qa_invoices_outstanding_idx
  on qa_invoices (business_id, due_date)
  where status = 'sent';

-- One invoice per quote. Raising a second invoice for the same accepted quote
-- is double-billing a customer, which is the single worst thing this table
-- could be used to do by accident — a double-click on "Create invoice" must
-- not be able to cause it.
create unique index if not exists qa_invoices_quote_idx
  on qa_invoices (quote_id)
  where quote_id is not null;

alter table qa_invoices enable row level security;

drop policy if exists "members manage their own invoices" on qa_invoices;
create policy "members manage their own invoices"
  on qa_invoices
  for all
  using (is_active_tenant_member (business_id))
  with check (is_active_tenant_member (business_id));

comment on table qa_invoices is
  'Invoices raised from accepted QuoteIQ quotes, or directly. amount_cents is an exact integer — unlike qa_quotes.total, which is free text. One invoice per quote, enforced by a partial unique index, so a double-click cannot double-bill.';

-- ---------------------------------------------------------------------
-- 0038_invoice_chasing.sql
-- ---------------------------------------------------------------------

-- =============================================================================
-- 0038 — Automatic chasing for overdue invoices
--
-- /products/tradeiq: "Chasing is automatic rather than a job for a Sunday
-- evening." 0037 made invoices real; nothing ever chased them. An invoice
-- could go out, go past its due date, and sit there forever with the platform
-- silent — which is precisely the Sunday-evening job the page says it removes.
--
-- Two columns are all it takes, and both exist to answer "have we already
-- nagged this person, and how hard":
--
--   last_chased_at — when the last reminder went. NULL = never chased, which
--     is what makes the first chase findable without a second query.
--   chase_count    — how many have gone. The tone escalates and the sequence
--     STOPS; a business that emails a customer every day about EUR 300 does
--     more damage to the relationship than the debt is worth.
--
-- Nullable and defaulted, so every invoice already raised is untouched and
-- reads correctly as "never chased".
--
-- Idempotent. Safe to re-run. Purely additive.
-- =============================================================================

alter table qa_invoices
  add column if not exists last_chased_at timestamptz;

alter table qa_invoices
  add column if not exists chase_count integer not null default 0;

-- The chaser's only query: sent, unpaid, past due, and not chased recently.
-- Partial on status so the index carries only the rows that can ever be
-- chased — a paid or voided invoice is never a candidate.
create index if not exists qa_invoices_chase_idx
  on qa_invoices (due_date, last_chased_at nulls first)
  where status = 'sent';

comment on column qa_invoices.last_chased_at is
  'When the last overdue reminder was sent. Null = never chased, and sorts first so the oldest neglected invoice is always found before one already nagged.';

comment on column qa_invoices.chase_count is
  'How many reminders have gone out. The sequence stops at a hard cap — chasing a customer indefinitely costs more than the invoice is worth.';

-- ---------------------------------------------------------------------
-- 0039_content_sends.sql
-- ---------------------------------------------------------------------

-- =============================================================================
-- 0039 — ContentIQ actually publishes something
--
-- ContentIQ generated a post and then offered "Mark published" — a checkbox
-- that set a status and published NOTHING. The content sat in a table. The
-- customer copied it somewhere by hand, or didn't. A product whose entire
-- purpose is producing content had no way to deliver any.
--
-- Email is the one channel this platform genuinely has (Resend), and ClientIQ
-- now holds a real audience. So "publish" becomes: send this piece to your
-- customer list, and keep a per-recipient record of it.
--
-- WHY A PER-RECIPIENT TABLE rather than a count on ca_content.
--
-- Sending to a list is the single most dangerous thing this platform can do on
-- a customer's behalf. The things that go wrong are all "who exactly got
-- what": the same person receiving a piece twice, a send half-completing and
-- being re-run from the start, someone who opted out being included anyway.
-- A counter answers none of those. A row per recipient answers all of them,
-- and the unique index below makes double-sending impossible rather than
-- unlikely.
--
-- Idempotent. Safe to re-run. Purely additive.
-- =============================================================================

alter table ca_content
  add column if not exists sent_at timestamptz;

alter table ca_content
  add column if not exists recipient_count integer not null default 0;

create table if not exists ca_sends (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  content_id uuid not null references ca_content (id) on delete cascade,
  -- Nullable: a recipient may have been removed from the CRM afterwards, and
  -- deleting the contact must not erase the record that they were emailed.
  contact_id uuid references crm_contacts (id) on delete set null,
  email text not null,
  status text not null default 'sent' check (status in ('sent', 'failed')),
  error text,
  created_at timestamptz not null default now()
);

-- THE guarantee: one send per piece of content per address, case-insensitive.
-- A re-run, a double-click or a half-finished batch picked up again can never
-- send the same person the same thing twice — the database refuses it rather
-- than the code remembering to.
create unique index if not exists ca_sends_content_email_idx
  on ca_sends (content_id, lower(email));

create index if not exists ca_sends_business_created_idx
  on ca_sends (business_id, created_at desc);

alter table ca_sends enable row level security;

drop policy if exists "members manage their own content sends" on ca_sends;
create policy "members manage their own content sends"
  on ca_sends
  for all
  using (is_active_tenant_member (business_id))
  with check (is_active_tenant_member (business_id));

comment on table ca_sends is
  'One row per recipient per piece of ContentIQ content. The unique index on (content_id, lower(email)) makes double-sending impossible, so a retry or a half-finished batch is always safe to re-run.';

-- ---------------------------------------------------------------------
-- 0040_siteiq_page.sql
-- ---------------------------------------------------------------------

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

-- ---------------------------------------------------------------------
-- 0041_review_autopilot.sql
-- ---------------------------------------------------------------------

-- =============================================================================
-- 0041 — ReputationIQ asks on its own when a job is finished
--
-- /products/reputationiq sells "Ask while the job is still fresh — send the
-- request the day you finish, when goodwill is at its highest." Everything
-- about that is built except the part that matters: somebody has to remember
-- to press Send, on the day, for every job. On the evening of a long week
-- nobody does, and the goodwill window closes.
--
-- QuoteIQ now knows exactly when a job finished, because the business marks
-- the invoice PAID. That is the most reliable "this went well" signal in the
-- platform — better than a job status somebody has to maintain, because it is
-- a thing they do anyway for their own reasons.
--
-- So: invoice paid -> review request goes out on the next morning run.
--
-- WHY A COLUMN ON THE INVOICE RATHER THAN A NEW TABLE.
--
-- The only question this feature has to answer is "have we already asked
-- about THIS job?", and the job is the invoice. A timestamp on the invoice
-- answers it exactly, cannot drift out of sync with the thing it describes,
-- and disappears with the invoice if that is ever deleted.
--
-- OPT-IN, DEFAULT OFF. Nothing changes for any existing customer until they
-- switch it on, and switching it on cannot reach backwards — see the age
-- window in lib/review-agent/auto-request.ts, which is the guard that stops
-- flipping this toggle from emailing every customer of the last two years at
-- once.
--
-- Idempotent. Safe to re-run. Purely additive.
-- =============================================================================

-- Set the moment a request is sent for this invoice, so a second run can
-- never ask the same customer about the same job twice.
alter table qa_invoices
  add column if not exists review_requested_at timestamptz;

-- The opt-in. Default false: an existing business's behaviour is unchanged
-- until a human decides otherwise.
alter table businesses
  add column if not exists auto_review_requests boolean not null default false;

-- The nightly scan: paid invoices that have not been asked about yet.
--
-- Partial, because the rows it must never return are the overwhelming
-- majority — every invoice already asked about, forever.
--
-- Led by paid_at, NOT business_id: the run sweeps every tenant at once and
-- orders by when the job finished. A business_id-first index cannot serve
-- that, and the planner falls back to a sequential scan of the whole invoice
-- table on every morning run — confirmed on scratch Postgres before this was
-- changed.
create index if not exists qa_invoices_review_pending_idx
  on qa_invoices (paid_at)
  where status = 'paid' and review_requested_at is null;

comment on column qa_invoices.review_requested_at is
  'When ReputationIQ asked this customer for a review about this job. Set once, immediately after the send, so a re-run can never ask twice. Null means never asked.';

comment on column businesses.auto_review_requests is
  'Opt-in: when true, marking an invoice paid queues a review request for the next morning run. Default false so existing behaviour is unchanged, and turning it on cannot reach back over old invoices.';

-- ---------------------------------------------------------------------
-- 0042_prospect_views.sql
-- ---------------------------------------------------------------------

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

commit;
