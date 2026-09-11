\set ON_ERROR_STOP on
\set VERBOSITY verbose
select set_config('application_name', 'm40-competitor:' || :'race_name', false);

\echo @@TECM_M40_PHASE@@session_setup
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', false);
select set_config('app.test_race', :'race_name', false);
select set_config('app.test_session_id', :'session_id', false);
select set_config('app.test_expected_revision', :'expected_revision', false);
select set_config('app.test_status', :'target_status', false);
select set_config('app.test_request_id', :'request_id', false);

\echo @@TECM_M40_PHASE@@rpc_timeout_armed
set statement_timeout = '3s';
\echo @@TECM_M40_PHASE@@rpc_statement_started
do $$
declare
  started_at timestamptz := statement_timestamp();
  elapsed_ms numeric;
  caught_sqlstate text;
  caught_message text;
  semantic_classification text;
begin
  begin
    raise notice '@@TECM_M40_PHASE@@rpc_invoked';
    perform public.submit_teacher_attendance(
      current_setting('app.test_session_id')::uuid,
      '15000000-0000-4000-8000-000000000001',
      current_setting('app.test_status'),
      nullif(current_setting('app.test_expected_revision'), '')::bigint,
      'bounded contention proof',
      current_setting('app.test_request_id')
    );
    raise exception 'contention competitor unexpectedly mutated attendance';
  exception
    when sqlstate '57014' then
      get stacked diagnostics
        caught_sqlstate = returned_sqlstate,
        caught_message = message_text;
      elapsed_ms := extract(epoch from (clock_timestamp() - started_at)) * 1000;
      if caught_sqlstate <> '57014' then
        raise notice '@@TECM_M40_PHASE@@rpc_timeout_sqlstate_invalid';
        raise;
      end if;
      if caught_message <> 'canceling statement due to statement timeout' then
        raise notice '@@TECM_M40_PHASE@@rpc_timeout_message_invalid';
        raise;
      end if;
      if elapsed_ms < 2500 then
        raise notice '@@TECM_M40_PHASE@@rpc_timeout_elapsed_below_minimum';
        raise;
      end if;
      if elapsed_ms >= 5000 then
        raise notice '@@TECM_M40_PHASE@@rpc_timeout_elapsed_above_maximum';
        raise;
      end if;
      raise notice '@@TECM_M40_PHASE@@rpc_timeout_canonical';
      semantic_classification := 'm40_blocking_statement_timeout_v1';
    when others then
      get stacked diagnostics
        caught_sqlstate = returned_sqlstate,
        caught_message = message_text;
      elapsed_ms := extract(epoch from (clock_timestamp() - started_at)) * 1000;
      if caught_sqlstate <> 'P0001'
         or caught_message <> 'attendance update is already in progress'
         or elapsed_ms >= 2000 then
        raise;
      end if;
      semantic_classification := 'attendance update is already in progress';
  end;

  if semantic_classification is null then
    raise exception 'contention competitor produced no semantic classification';
  end if;

  if elapsed_ms is null then
    elapsed_ms := extract(epoch from (clock_timestamp() - started_at)) * 1000;
  end if;

  if semantic_classification = 'attendance update is already in progress'
     and elapsed_ms >= 2000 then
    raise exception 'contention competitor exceeded the bounded interval';
  end if;
  if semantic_classification = 'm40_blocking_statement_timeout_v1'
     and (elapsed_ms < 2500 or elapsed_ms >= 5000) then
    raise exception 'contention competitor statement-timeout classification was outside its exact interval';
  end if;

  insert into public.__test_teacher_attendance_contention_result (
    race, classification, elapsed_milliseconds
  ) values (
    current_setting('app.test_race'),
    semantic_classification,
    elapsed_ms
  );
end
$$;

reset statement_timeout;
reset role;
\echo @@TECM_M40_PHASE@@post_rpc
select 'teacher attendance contention competitor: exact semantic classification recorded' as passed;
