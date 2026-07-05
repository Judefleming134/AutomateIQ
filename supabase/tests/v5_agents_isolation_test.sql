-- Tenant-isolation check for the V5 agent tables (ca_content, qa_settings,
-- qa_quotes, stl_replies). Disposable-database harness only.
begin;

insert into businesses (id, name) values
  ('88888881-0000-0000-0000-000000000001', 'V5 Iso Tenant A'),
  ('88888882-0000-0000-0000-000000000002', 'V5 Iso Tenant B');

insert into auth.users (id, raw_user_meta_data) values
  ('88888881-aaaa-0000-0000-000000000001', '{"role":"customer","business_id":"88888881-0000-0000-0000-000000000001"}'),
  ('88888882-bbbb-0000-0000-000000000002', '{"role":"customer","business_id":"88888882-0000-0000-0000-000000000002"}');

insert into profiles (id, role, business_id) values
  ('88888881-aaaa-0000-0000-000000000001', 'customer', '88888881-0000-0000-0000-000000000001'),
  ('88888882-bbbb-0000-0000-000000000002', 'customer', '88888882-0000-0000-0000-000000000002')
on conflict (id) do nothing;

insert into ca_content (business_id, content_type, topic, body) values
  ('88888881-0000-0000-0000-000000000001', 'social', 'A topic', 'A body'),
  ('88888882-0000-0000-0000-000000000002', 'social', 'B topic', 'B body');

insert into qa_settings (business_id, price_guide) values
  ('88888881-0000-0000-0000-000000000001', 'A prices'),
  ('88888882-0000-0000-0000-000000000002', 'B prices');

insert into qa_quotes (business_id, customer_name, job_description) values
  ('88888881-0000-0000-0000-000000000001', 'A cust', 'A job'),
  ('88888882-0000-0000-0000-000000000002', 'B cust', 'B job');

insert into wa_leads (id, business_id, name, contact) values
  ('88888881-cccc-0000-0000-000000000001', '88888881-0000-0000-0000-000000000001', 'A lead', 'a@x.com'),
  ('88888882-dddd-0000-0000-000000000002', '88888882-0000-0000-0000-000000000002', 'B lead', 'b@x.com');

insert into stl_replies (business_id, lead_id, sent_to) values
  ('88888881-0000-0000-0000-000000000001', '88888881-cccc-0000-0000-000000000001', 'a@x.com'),
  ('88888882-0000-0000-0000-000000000002', '88888882-dddd-0000-0000-000000000002', 'b@x.com');

-- Become tenant A
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"88888881-aaaa-0000-0000-000000000001"}', true);

do $$
declare n int;
begin
  select count(*) into n from ca_content;
  if n <> 1 then raise exception 'ca_content isolation FAILED: saw % rows', n; end if;
  select count(*) into n from qa_settings;
  if n <> 1 then raise exception 'qa_settings isolation FAILED: saw % rows', n; end if;
  select count(*) into n from qa_quotes;
  if n <> 1 then raise exception 'qa_quotes isolation FAILED: saw % rows', n; end if;
  select count(*) into n from stl_replies;
  if n <> 1 then raise exception 'stl_replies isolation FAILED: saw % rows', n; end if;
  -- Cross-tenant write must be rejected (with check)
  begin
    insert into ca_content (business_id, content_type, topic, body)
      values ('88888882-0000-0000-0000-000000000002', 'social', 'x', 'x');
    raise exception 'ca_content cross-tenant INSERT was allowed';
  exception when insufficient_privilege or check_violation then
    null; -- expected
  end;
  -- stl_replies is read-only for members: own-tenant insert must also fail
  begin
    insert into stl_replies (business_id, lead_id, sent_to)
      values ('88888881-0000-0000-0000-000000000001', '88888881-cccc-0000-0000-000000000001', 'x@x.com');
    raise exception 'stl_replies member INSERT was allowed (should be service-role only)';
  exception when insufficient_privilege or check_violation then
    null; -- expected
  end;
  raise notice 'V5 ISOLATION OK: all four tables scoped correctly';
end $$;

rollback;
