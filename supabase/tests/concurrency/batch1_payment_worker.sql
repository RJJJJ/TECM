\set ON_ERROR_STOP on
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
select set_config('app.batch1.race', :'race_name', false);
select set_config('app.batch1.worker', :'worker_name', false);
select set_config('app.batch1.charge_id', :'charge_id', false);
select set_config('app.batch1.amount_minor', :'amount_minor', false);
select set_config('app.batch1.method', :'method', false);
select set_config('app.batch1.idempotency_key', :'idempotency_key', false);
select set_config('app.batch1.payload_identity', :'payload_identity', false);
select set_config('app.batch1.fingerprint_classification', :'fingerprint_classification', false);
select public.__test_race_ready(:'race_name', :'worker_name');
select public.__test_race_wait(:'race_name', :'worker_name');
do $$
declare
  payment_id uuid;
  failure_state text;
  failure_message text;
  failure_classification text;
  failure_identifier text;
begin
  begin
    payment_id := public.record_payment(
      '10000000-0000-4000-8000-000000000000','13000000-0000-4000-8000-000000000001',
      current_setting('app.batch1.charge_id')::uuid,current_setting('app.batch1.amount_minor')::bigint,
      current_setting('app.batch1.method'),current_setting('app.batch1.idempotency_key'));
    insert into public.__test_batch1_worker_results (
      race,worker,operation,outcome,classification,payload_identity,fingerprint_classification,result_id
    ) values (
      current_setting('app.batch1.race'),current_setting('app.batch1.worker'),'payment','committed','committed',
      current_setting('app.batch1.payload_identity'),current_setting('app.batch1.fingerprint_classification'),payment_id);
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
      current_setting('app.batch1.race'),current_setting('app.batch1.worker'),'payment','rejected',failure_state,
      failure_classification,failure_identifier,current_setting('app.batch1.payload_identity'),
      current_setting('app.batch1.fingerprint_classification'));
  end;
end
$$;
