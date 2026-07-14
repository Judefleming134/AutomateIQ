-- Adds the ElevenLabs conversation id to captured voice jobs, so duplicate
-- webhook deliveries (ElevenLabs retries on timeouts/non-2xx) can be deduped
-- and a job can be traced back to its exact call. Purely additive and
-- OPTIONAL: the webhook detects a missing column and simply skips deduping,
-- so nothing breaks if this hasn't run yet.

alter table va_jobs add column if not exists conversation_id text;

-- Lookup index for the dedupe check (one small query per webhook delivery).
create index if not exists va_jobs_conversation_id_idx
  on va_jobs (conversation_id)
  where conversation_id is not null;
