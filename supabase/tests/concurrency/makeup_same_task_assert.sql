\set ON_ERROR_STOP on
do $$ begin
  if (select count(*) from public.makeup_sessions
      where makeup_task_id = '44000000-0000-4000-8000-000000000301'
        and status in ('scheduled', 'completed')) <> 1 then
    raise exception 'same-task booking/completion race did not leave exactly one live session';
  end if;
  if not exists (
    select 1
    from public.makeup_tasks mt
    join public.makeup_entitlements me on me.id = mt.entitlement_id
    join public.makeup_sessions ms on ms.makeup_task_id = mt.id
    where mt.id = '44000000-0000-4000-8000-000000000301'
      and (
        (mt.status = 'scheduled' and me.status = 'reserved' and ms.status = 'scheduled')
        or (mt.status = 'completed' and me.status = 'consumed' and ms.status = 'completed')
      )
  ) then
    raise exception 'same-task booking/completion race left incoherent task/session/entitlement state';
  end if;
  if (select count(*) from public.communication_logs
      where organization_id = '10000000-0000-4000-8000-000000000000'
        and idempotency_key = 'makeup-booked:44000000-0000-4000-8000-000000000301') <> 1 then
    raise exception 'same-task booking/completion race did not create exactly one booking communication';
  end if;
end $$;
