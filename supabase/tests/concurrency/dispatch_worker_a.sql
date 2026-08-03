\set ON_ERROR_STOP on
set role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',false);
select public.__test_race_ready('dispatch', 'first');
select public.__test_race_wait('dispatch', 'first');
begin;
select public.begin_notification_dispatch(o.id,'010-dispatch-worker-a',o.apns_request_id)
from public.notification_outbox o
join public.notifications n on n.id=o.notification_id
where n.event_key='010:dispatch-race'
  and o.status='claimed'
  and o.claimed_by='010-dispatch-worker-a';
commit;
