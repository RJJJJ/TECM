\set ON_ERROR_STOP on

set statement_timeout = '3s';
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', false);
select set_config('app.test_race', :'race_name', false);
select set_config('app.test_session_id', :'session_id', false);
select set_config('app.test_expected_revision', :'expected_revision', false);
select set_config('app.test_status', :'target_status', false);
select set_config('app.test_request_id', :'request_id', false);

do $$
declare
  started_at timestamptz := clock_timestamp();
  elapsed_ms numeric;
begin
  begin
    perform public.submit_teacher_attendance(
      current_setting('app.test_session_id')::uuid,
      '15000000-0000-4000-8000-000000000001',
      current_setting('app.test_status'),
      nullif(current_setting('app.test_expected_revision'), '')::bigint,
      'bounded contention proof',
      current_setting('app.test_request_id')
    );
    raise exception 'contention competitor unexpectedly mutated attendance';
  exception when others then
    if sqlerrm <> 'attendance update is already in progress' then
      raise exception 'M40 bounded contention classification missing';
    end if;
  end;

  elapsed_ms := extract(epoch from (clock_timestamp() - started_at)) * 1000;
  if elapsed_ms >= 2000 then
    raise exception 'contention competitor exceeded the bounded interval';
  end if;

  insert into public.__test_teacher_attendance_contention_result (
    race, classification, elapsed_milliseconds
  ) values (
    current_setting('app.test_race'),
    'attendance update is already in progress',
    elapsed_ms
  );
end
$$;

reset role;
reset statement_timeout;
select 'teacher attendance contention competitor: immediate safe classification' as passed;
