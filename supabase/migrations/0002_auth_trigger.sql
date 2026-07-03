-- Atomic profile creation: a profiles row is created in the SAME operation
-- as the auth.users row, driven by a trigger, so there is no window where a
-- user exists without a profile (which would make every RLS policy that
-- joins through profiles silently deny that user everything).
--
-- role/business_id are read from raw_user_meta_data, which the admin sets
-- explicitly when calling supabase.auth.admin.createUser({ user_metadata }).
-- Defaults to role='customer' with no business_id if unset (should not
-- happen in practice — every admin-created user must set these).

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, role, business_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'role', 'customer'),
    nullif(new.raw_user_meta_data ->> 'business_id', '')::uuid
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
