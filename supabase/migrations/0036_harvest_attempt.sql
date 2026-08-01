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
