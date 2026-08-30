\set ON_ERROR_STOP on
select set_config('app.test_batch1_idempotency_key', :'idempotency_key', false);
do $$
declare
  operation_key constant text := current_setting('app.test_batch1_idempotency_key');
begin
  if (select count(*) from public.student_packages where organization_id='10000000-0000-4000-8000-000000000000' and idempotency_key=operation_key) <> 1
     or (select count(*) from public.credit_ledger where organization_id='10000000-0000-4000-8000-000000000000' and idempotency_key='package:'||operation_key) <> 1
     or (select count(*) from public.charges where organization_id='10000000-0000-4000-8000-000000000000' and idempotency_key='charge:'||operation_key) <> 1 then
    raise exception 'batch1 intake race did not persist exactly one package/credit/charge set';
  end if;
  if (select request_fingerprint from public.student_packages where organization_id='10000000-0000-4000-8000-000000000000' and idempotency_key=operation_key) is null then
    raise exception 'batch1 intake race omitted canonical fingerprint';
  end if;
end
$$;
select 'batch1 intake race: one enrollment/package/effect set and canonical fingerprint' as passed;
