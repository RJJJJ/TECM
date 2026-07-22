\set ON_ERROR_STOP on
set statement_timeout='10s';
set lock_timeout='5s';
set role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',false);

insert into public.__test_outbox_claim_barrier(worker) values('outbox-worker-b')
on conflict (worker) do update set ready_at=statement_timestamp();

do $$ declare i integer; begin
  for i in 1..100 loop
    exit when exists(select 1 from public.__test_outbox_claim_barrier
      where worker='outbox-worker-b' and released_at is not null);
    perform pg_sleep(0.1);
  end loop;
  if not exists(select 1 from public.__test_outbox_claim_barrier
      where worker='outbox-worker-b' and released_at is not null) then
    raise exception 'worker b release barrier timed out';
  end if;
end $$;

create temporary table outbox_claim_result as
select * from public.claim_notification_outbox('outbox-worker-b',1,60);

do $$ declare n integer; begin
  select count(*) into n from outbox_claim_result;
  if n not in (0,1) then raise exception 'worker b claimed an impossible row count'; end if;
end $$;
