\set ON_ERROR_STOP on
do $$ begin
  if (select count(*) from public.__test_outbox_claim_barrier
      where worker in ('outbox-worker-a','outbox-worker-b')
        and released_at is not null)<>2 then
    raise exception 'outbox claim race did not observe both ready workers';
  end if;
  if (select count(*) from public.notification_outbox o join public.notifications n on n.id=o.notification_id
      where n.event_key='concurrency:outbox:claim'
        and o.status='claimed'
        and o.claimed_by in ('outbox-worker-a','outbox-worker-b')
        and o.attempt_count=1)<>1 then
    raise exception 'outbox claim race did not produce exactly one claimed row';
  end if;
  if exists(select 1 from public.notification_outbox o join public.notifications n on n.id=o.notification_id
      where n.event_key='concurrency:outbox:claim'
        and o.claimed_by is not null
        and o.claimed_by not in ('outbox-worker-a','outbox-worker-b')) then
    raise exception 'outbox claim race assigned an unexpected worker';
  end if;
end $$;
