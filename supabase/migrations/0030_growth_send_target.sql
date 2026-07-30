-- ---------------------------------------------------------------------------
-- Daily outreach send target, moved out of an environment variable.
--
-- GROWTH_AUTOQUEUE_TARGET could only be changed in Vercel, which means a
-- redeploy-shaped task stands between Jude and the single number that decides
-- how much outreach goes out. That number needs to be changeable from the
-- Growth Engine itself, on a phone, between calls.
--
-- The value is a DESTINATION, not a daily quota — resolveSendRamp() still
-- paces the climb toward it and still holds volume on bounces or complaints,
-- so a big number here can't burn the sending domain.
--
-- Additive and idempotent: the column has a default, so existing rows get it
-- without a backfill and nothing reads differently until it's changed.
-- ---------------------------------------------------------------------------

alter table ge_settings
  add column if not exists daily_send_target int not null default 250
    check (daily_send_target between 0 and 2000);

comment on column ge_settings.daily_send_target is
  'Destination for daily first-touch outreach emails. The auto-queue ramps toward this ~50%/day (faster on a provably clean list) and holds on bounces/complaints. 0 disables auto-queueing entirely.';
