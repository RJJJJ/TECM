\set ON_ERROR_STOP on
set role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',false);
select public.__test_race_ready('invite', 'second');
select public.__test_race_wait('invite', 'second');
select public.link_parent_auth_account(
  '10000000-0000-4000-8000-000000000000',
  '93000000-0000-4000-8000-000000000096',
  '90000000-0000-4000-8000-000000000095',
  'collision-parent-b@tecm.test',
  'foundation:race:second',
  '10000000-0000-4000-8000-000000000001'
);
