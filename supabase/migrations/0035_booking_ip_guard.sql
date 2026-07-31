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
