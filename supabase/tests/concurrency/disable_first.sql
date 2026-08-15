\set ON_ERROR_STOP on
set role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',false);
begin;
select id from public.parent_profiles
where id='93000000-0000-4000-8000-000000000095'
for update;
select public.__test_race_ready('disable-register', 'first');
select public.__test_race_wait('disable-register', 'first');
select public.disable_parent_account(
  '10000000-0000-4000-8000-000000000000',
  '93000000-0000-4000-8000-000000000095'
);
commit;
