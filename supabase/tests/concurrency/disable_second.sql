\set ON_ERROR_STOP on
set role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',false);
select public.__test_race_ready('register-disable', 'second');
select public.__test_race_wait('register-disable', 'second');
select public.disable_parent_account(
  '10000000-0000-4000-8000-000000000000',
  '93000000-0000-4000-8000-000000000095'
);
