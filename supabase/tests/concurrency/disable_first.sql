\set ON_ERROR_STOP on
begin;
set role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',false);
select id from public.parent_profiles
where id='93000000-0000-4000-8000-000000000095'
for update;
select pg_sleep(2);
select public.disable_parent_account(
  '10000000-0000-4000-8000-000000000000',
  '93000000-0000-4000-8000-000000000095'
);
commit;
