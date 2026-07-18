\set ON_ERROR_STOP on
reset role;
delete from public.notification_delivery_attempts
where notification_id in (select id from public.notifications where event_key='010:dispatch-race');
delete from public.notification_outbox
where notification_id in (select id from public.notifications where event_key='010:dispatch-race');
delete from public.notifications where event_key='010:dispatch-race';

insert into public.notifications(
  organization_id,parent_id,recipient_user_id,category,title,body,event_key,source,expires_at
) values(
  '10000000-0000-4000-8000-000000000000',
  '13000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000003',
  'transactional','Dispatch race','Body','010:dispatch-race','test',
  statement_timestamp()+interval '1 hour'
);

-- The notification trigger fans out to every active registration. Keep this
-- fixture to the installation created by outbox_setup so the race has one row.
delete from public.notification_outbox o
using public.notifications n, public.push_devices d
where o.notification_id=n.id
  and o.device_id=d.id
  and n.event_key='010:dispatch-race'
  and d.installation_id<>'outbox-race-install';

do $$ begin
  if (select count(*) from public.notification_outbox o
      join public.notifications n on n.id=o.notification_id
      where n.event_key='010:dispatch-race' and o.status='pending')<>1 then
    raise exception 'dispatch race setup did not create exactly one pending row';
  end if;
end $$;

set role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',false);
select * from public.claim_notification_outbox('010-dispatch-worker-a',1,60);
