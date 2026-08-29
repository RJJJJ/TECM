\set ON_ERROR_STOP on
do $$ begin
  if (select count(*) from public.makeup_sessions
      where makeup_task_id = '44000000-0000-4000-8000-000000000201'
        and status = 'completed') <> 1 then
    raise exception 'makeup completion race did not complete exactly one session';
  end if;
  if (select status from public.makeup_entitlements
      where id = '44000000-0000-4000-8000-000000000201') <> 'consumed' then
    raise exception 'makeup completion race did not consume entitlement';
  end if;
end $$;
