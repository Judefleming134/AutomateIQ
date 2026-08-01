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
