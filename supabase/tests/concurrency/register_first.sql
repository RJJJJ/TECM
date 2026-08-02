\set ON_ERROR_STOP on
begin;
set role authenticated;
select set_config('request.jwt.claims','{}',false);
select set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000095',false);
-- The lock is a test harness barrier, not an application write. Acquire it
-- with the database verification role because SELECT ... FOR UPDATE requires
-- UPDATE privilege, which the release gate intentionally revokes.
set role service_role;
select id from public.parent_profiles
where id='93000000-0000-4000-8000-000000000095'
for update;
set role authenticated;
select public.register_push_device(
  'foundation-race-install',repeat('f',64),'sandbox','app.TECM','1.0','iPhone'
);
select pg_sleep(2);
commit;
