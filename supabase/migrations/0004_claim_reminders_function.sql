-- The reminder cron's atomic "claim before send" step (see Stage 6 plan)
-- needs FOR UPDATE SKIP LOCKED, which PostgREST's query builder can't
-- express — so it's a Postgres function called via RPC from the
-- service-role client instead. This is the exact query verified in
-- Stage 1 against a real Postgres instance: claims exactly the eligible
-- rows on the first call and zero rows on an immediately-repeated call,
-- which is what makes the exactly-once-reminder guarantee hold even if
-- the cron endpoint is somehow invoked twice concurrently.
create function claim_due_reminders(batch_size int default 200)
returns setof ra_review_requests
language sql
security definer
set search_path = public
as $$
  update ra_review_requests
  set reminder_sent_at = now(), status = 'reminded'
  where id in (
    select id from ra_review_requests
    where sent_at <= now() - interval '3 days'
      and reminder_sent_at is null
      and status = 'sent'
    for update skip locked
    limit batch_size
  )
  returning *;
$$;

-- Only the service role calls this (the cron dispatcher, gated by
-- CRON_SECRET). Postgres grants EXECUTE to PUBLIC by default for new
-- functions — revoking only from authenticated/anon leaves that PUBLIC
-- grant in place and does NOT actually block them (verified: without this
-- line, calling the function as `authenticated` still succeeds). Must
-- revoke from PUBLIC explicitly, which then means no role can call it
-- except the function owner and any role explicitly granted afterward
-- (service_role has the superuser-like bypassrls/broad-grants setup
-- Supabase configures for it, so it retains access).
revoke execute on function claim_due_reminders(int) from public;

-- service_role is not the function owner and does not automatically
-- inherit execute rights just by bypassing RLS — it needs its own
-- explicit grant like any other role, same as PUBLIC needed revoking
-- explicitly above.
grant execute on function claim_due_reminders(int) to service_role;
