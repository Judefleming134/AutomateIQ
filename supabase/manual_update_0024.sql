-- =============================================================================
-- AutomateIQ manual update 0024 — Voice job dedupe by call id (OPTIONAL)
--
-- Run in the Supabase SQL Editor (after 0023). Fully idempotent — safe to
-- re-run. Identical to supabase/migrations/0024_va_jobs_conversation_id.sql.
--
-- Adds the ElevenLabs conversation id to captured voice jobs, so duplicate
-- webhook deliveries (ElevenLabs retries) are deduped and a job can be traced
-- to its exact call. OPTIONAL: the webhook detects a missing column and
-- simply skips deduping — nothing breaks if this hasn't run yet.
-- =============================================================================

alter table va_jobs add column if not exists conversation_id text;

create index if not exists va_jobs_conversation_id_idx
  on va_jobs (conversation_id)
  where conversation_id is not null;
