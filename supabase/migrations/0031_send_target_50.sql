-- ---------------------------------------------------------------------------
-- Set the daily outreach send target to 50.
--
-- 0030 introduced ge_settings.daily_send_target with a placeholder default of
-- 250, chosen before Jude had said what he wanted. On 2026-07-31 he set the
-- number: 50 a day. This writes it, so the engine ships with the real value
-- rather than waiting on someone to type it into /growth/settings.
--
-- 50 is a DESTINATION, not a daily quota. resolveSendRamp() still paces the
-- climb — the floor is 20 and the step is 1.5x/day (2x on a provably clean
-- list), so this lands as roughly 20 -> 30 -> 45 -> 50 over four sending days,
-- and still holds volume the moment bounces or complaints move. A month-old
-- domain cannot be burned by this number.
--
-- Safe to run whether or not 0030 was applied: the ADD COLUMN is guarded by
-- IF NOT EXISTS (which skips its CHECK too, so re-running can't collide with
-- the existing constraint), and both remaining statements are idempotent.
-- Re-running it is a no-op, not a second change.
-- ---------------------------------------------------------------------------

alter table ge_settings
  add column if not exists daily_send_target int not null default 50
    check (daily_send_target between 0 and 2000);

-- New installs start at the real number, not the placeholder.
alter table ge_settings alter column daily_send_target set default 50;

-- The live row. Unconditional on purpose: this IS the value Jude asked for,
-- and anything already in the column is the placeholder from 0030.
update ge_settings set daily_send_target = 50;
