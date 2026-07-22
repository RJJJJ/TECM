\set ON_ERROR_STOP on
set role authenticated;
select set_config('request.jwt.claims','{}',false);
select set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000095',false);
select public.register_push_device(
  'foundation-race-install',repeat('e',64),'sandbox','app.TECM','1.0','iPhone'
);
