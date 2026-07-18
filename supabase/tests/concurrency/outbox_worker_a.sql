\set ON_ERROR_STOP on
set statement_timeout='10s';
set lock_timeout='5s';
set role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',false);

insert into public.__test_outbox_claim_barrier(worker) values('outbox-worker-a')
on conflict (worker) do update set ready_at=statement_timestamp();
do $$ declare deadline timestamptz:=clock_timestamp()+interval '8 seconds'; begin
  while (select count(*) from public.__test_outbox_claim_barrier
      where worker in ('outbox-worker-a','outbox-worker-b'))<2 loop
    if clock_timestamp()>=deadline then
      raise exception 'worker a timed out waiting for outbox claim peer readiness';
    end if;
    perform pg_sleep(0.05);
  end loop;
end $$;

create temporary table outbox_claim_result as
select * from public.claim_notification_outbox('outbox-worker-a',1,60);

do $$ declare n integer; begin
  select count(*) into n from outbox_claim_result;
  if n not in (0,1) then raise exception 'worker a claimed an impossible row count'; end if;
end $$;
