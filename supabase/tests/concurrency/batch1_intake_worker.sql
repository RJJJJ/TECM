\set ON_ERROR_STOP on
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
select set_config('app.batch1.race', :'race_name', false);
select set_config('app.batch1.worker', :'worker_name', false);
select set_config('app.batch1.guardian_name', :'guardian_name', false);
select set_config('app.batch1.phone', :'phone', false);
select set_config('app.batch1.student_name', :'student_name', false);
select set_config('app.batch1.idempotency_key', :'idempotency_key', false);
select set_config('app.batch1.payload_identity', :'payload_identity', false);
select set_config('app.batch1.fingerprint_classification', :'fingerprint_classification', false);
select public.__test_race_ready(:'race_name', :'worker_name');
select public.__test_race_wait(:'race_name', :'worker_name');
do $$
declare
  intake_result jsonb;
  failure_state text;
  failure_message text;
  failure_classification text;
  failure_identifier text;
begin
  begin
    intake_result := public.create_guardian_student_enrollment_package(
      '10000000-0000-4000-8000-000000000000',current_setting('app.batch1.guardian_name'),
      current_setting('app.batch1.phone'),current_setting('app.batch1.student_name'),'Batch1 Race School',
      '1a000000-0000-4000-8000-000000000001','1e000000-0000-4000-8000-000000000001',
      current_setting('app.batch1.idempotency_key'));
    insert into public.__test_batch1_worker_results (
      race,worker,operation,outcome,classification,payload_identity,fingerprint_classification,result_id
    ) values (
      current_setting('app.batch1.race'),current_setting('app.batch1.worker'),'intake','committed','committed',
      current_setting('app.batch1.payload_identity'),current_setting('app.batch1.fingerprint_classification'),
      (intake_result->>'student_id')::uuid);
  exception when others then
    get stacked diagnostics failure_state=returned_sqlstate,failure_message=message_text;
    if failure_state='P0001' and failure_message='idempotency key payload mismatch' then
      failure_classification := 'idempotency_payload_mismatch'; failure_identifier := 'idempotency_key_payload_mismatch';
    elsif failure_state='23505' then
      failure_classification := 'unique_violation'; failure_identifier := 'unique_violation';
    else
      failure_classification := 'unexpected_sql_failure'; failure_identifier := 'unexpected_sql_failure';
    end if;
    insert into public.__test_batch1_worker_results (
      race,worker,operation,outcome,sqlstate,classification,error_identifier,payload_identity,fingerprint_classification
    ) values (
      current_setting('app.batch1.race'),current_setting('app.batch1.worker'),'intake','rejected',failure_state,
      failure_classification,failure_identifier,current_setting('app.batch1.payload_identity'),
      current_setting('app.batch1.fingerprint_classification'));
  end;
end
$$;
