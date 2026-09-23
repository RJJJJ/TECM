\set ON_ERROR_STOP on
do $$ begin
  if (select count(*) from public.makeup_sessions
      where organization_id = '10000000-0000-4000-8000-000000000000'
        and idempotency_key = 'race-makeup-booking') <> 1 then
    raise exception 'makeup booking race created duplicate sessions';
  end if;
  if (select status from public.makeup_entitlements
      where id = '44000000-0000-4000-8000-000000000101') <> 'reserved' then
    raise exception 'makeup booking race did not reserve entitlement';
  end if;
end $$;
