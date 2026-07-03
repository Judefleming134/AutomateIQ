-- Tenant-isolation smoke test. Not a full test suite — this is the single
-- highest-consequence correctness property in the system (a customer must
-- never see another business's data), so it gets a real, repeatable check
-- even in an otherwise test-light V1.
--
-- Run against a disposable database (never production):
--   psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/tenant_isolation_test.sql
--
-- Assumes migrations 0001-0003 and seed.sql have already been applied, and
-- that the target database has Supabase's standard auth.uid()/authenticated
-- role setup (i.e. this is meant to run against a real Supabase project's
-- database — local or hosted — not a bare Postgres instance).

begin;

insert into businesses (id, name) values
  ('99999991-0000-0000-0000-000000000001', 'Isolation Test — Tenant A'),
  ('99999992-0000-0000-0000-000000000002', 'Isolation Test — Tenant B');

insert into auth.users (id, raw_user_meta_data) values
  ('99999991-aaaa-0000-0000-000000000001', '{"role":"customer","business_id":"99999991-0000-0000-0000-000000000001"}'),
  ('99999992-bbbb-0000-0000-000000000002', '{"role":"customer","business_id":"99999992-0000-0000-0000-000000000002"}');

insert into ra_customers (business_id, name, email) values
  ('99999991-0000-0000-0000-000000000001', 'Tenant A recipient', 'a@example.com'),
  ('99999992-0000-0000-0000-000000000002', 'Tenant B recipient', 'b@example.com');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"99999991-aaaa-0000-0000-000000000001"}', true);

do $$
declare
  visible_count int;
  own_business_name text;
begin
  select count(*) into visible_count from ra_customers;
  if visible_count <> 1 then
    raise exception 'TENANT ISOLATION FAILURE: expected Tenant A to see exactly 1 ra_customers row, saw %', visible_count;
  end if;

  select name into own_business_name from businesses;
  if own_business_name <> 'Isolation Test — Tenant A' then
    raise exception 'TENANT ISOLATION FAILURE: Tenant A saw the wrong business row: %', own_business_name;
  end if;

  raise notice 'PASS: Tenant A sees only their own data';
end
$$;

update businesses set status = 'suspended'
  where id = '99999991-0000-0000-0000-000000000001';

do $$
declare
  visible_count int;
begin
  select count(*) into visible_count from ra_customers;
  if visible_count <> 0 then
    raise exception 'SUSPENSION ENFORCEMENT FAILURE: suspended Tenant A user still sees % rows', visible_count;
  end if;
  raise notice 'PASS: suspended business is blocked at the RLS layer';
end
$$;

rollback; -- never commit test fixtures
