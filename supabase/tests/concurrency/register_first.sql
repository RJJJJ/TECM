\set ON_ERROR_STOP on
begin;
set role authenticated;
select set_config('request.jwt.claims','{}',false);
select set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000095',false);
select id from public.parent_profiles
where id='93000000-0000-4000-8000-000000000095'
for update;
select public.register_push_device(
  'foundation-race-install',repeat('f',64),'sandbox','app.TECM','1.0','iPhone'
);
select pg_sleep(2);
commit;
