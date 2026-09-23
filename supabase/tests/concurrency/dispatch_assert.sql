\set ON_ERROR_STOP on
reset role;
do $$ begin
  if not exists(
    select 1 from public.notification_outbox o
    join public.notifications n on n.id=o.notification_id
    where n.event_key='010:dispatch-race'
      and o.status='dispatching'
      and o.claimed_by='010-dispatch-worker-a'
      and o.dispatch_started_at is not null
  ) then
    raise exception 'dispatch race did not preserve the single lease owner';
  end if;
end $$;
