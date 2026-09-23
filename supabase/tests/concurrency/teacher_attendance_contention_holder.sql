\set ON_ERROR_STOP on

select set_config('app.test_race', :'race_name', false);
select set_config('app.test_session_id', :'session_id', false);

begin;
select pg_advisory_xact_lock(hashtextextended(
  'teacher-attendance:10000000-0000-4000-8000-000000000000:'
  || current_setting('app.test_session_id')
  || ':15000000-0000-4000-8000-000000000001',
  0
));
select public.__test_race_ready(current_setting('app.test_race'), 'first');
-- Observe the actual waiting backend while this transaction owns the lock.
-- The witness stays private to the holder and cannot be written by the RPC.
create temporary table m40_lock_witness (proof jsonb) on commit preserve rows;
do $m40_holder$
begin
  for i in 1..200 loop
    perform pg_stat_clear_snapshot();
    if not exists (select 1 from m40_lock_witness) then
      insert into m40_lock_witness
      select jsonb_build_object('race', current_setting('app.test_race'),
        'holder_pid', h.pid, 'competitor_pid', w.pid, 'classid', h.classid,
        'objid', h.objid, 'objsubid', h.objsubid, 'observed_at', clock_timestamp())
      from pg_locks h join pg_locks w on
        w.locktype=h.locktype and w.database=h.database and
        w.classid=h.classid and w.objid=h.objid and w.objsubid=h.objsubid
      join pg_stat_activity a on a.pid=w.pid
      where h.pid=pg_backend_pid() and h.locktype='advisory' and h.granted
        and not w.granted and w.pid<>h.pid and h.pid=any(pg_blocking_pids(w.pid))
        and a.application_name='m40-competitor:' || current_setting('app.test_race')
        and a.wait_event_type='Lock' and a.wait_event='advisory';
    end if;
    exit when exists (select 1 from public.__test_race_barrier
      where race=current_setting('app.test_race') and worker='first' and released_at is not null);
    perform pg_sleep(0.1);
  end loop;
  if not exists (select 1 from public.__test_race_barrier
    where race=current_setting('app.test_race') and worker='first' and released_at is not null) then
    raise exception 'M40 holder barrier timed out';
  end if;
end
$m40_holder$;
select public.__test_race_wait(current_setting('app.test_race'), 'first');
commit;

do $m40_holder$
begin
  if exists (select 1 from public.__test_teacher_attendance_contention_result
    where race=current_setting('app.test_race') and classification='m40_blocking_statement_timeout_v1')
    and (select count(*) from m40_lock_witness) <> 1 then
    raise exception 'M40 blocking result has no unique same-lock waiting-backend witness';
  end if;
end
$m40_holder$;
select proof from m40_lock_witness;

select 'teacher attendance contention holder released cleanly' as passed;
