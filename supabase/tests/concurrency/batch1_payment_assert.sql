\set ON_ERROR_STOP on
select set_config('app.test_batch1_race', :'race_name', false);
select set_config('app.test_batch1_idempotency_key', :'idempotency_key', false);
select set_config('app.test_batch1_charge_id', :'winner_charge_id', false);
select set_config('app.test_batch1_amount_minor', :'winner_amount_minor', false);
select set_config('app.test_batch1_winner_identity', :'winner_identity', false);
select set_config('app.test_batch1_loser_identity', :'loser_identity', false);
select set_config('app.test_batch1_expected_mode', :'expected_mode', false);
do $$
declare
  race_key constant text := current_setting('app.test_batch1_race');
  operation_key constant text := current_setting('app.test_batch1_idempotency_key');
  charge_key constant uuid := current_setting('app.test_batch1_charge_id')::uuid;
  expected_amount constant bigint := current_setting('app.test_batch1_amount_minor')::bigint;
  winner_identity constant text := current_setting('app.test_batch1_winner_identity');
  loser_identity constant text := current_setting('app.test_batch1_loser_identity');
  expected_mode constant text := current_setting('app.test_batch1_expected_mode');
  payment_row public.payments%rowtype;
  baseline public.__test_batch1_operation_baseline%rowtype;
  expected_fingerprint text;
begin
  select * into baseline from public.__test_batch1_operation_baseline where race=race_key;
  if baseline.race is null then raise exception 'batch1 payment race baseline missing'; end if;
  if (select count(*) from public.__test_batch1_worker_results where race=race_key) <> 2
     or (select count(distinct worker) from public.__test_batch1_worker_results where race=race_key) <> 2
     or exists (select 1 from public.__test_batch1_worker_results where race=race_key and operation<>'payment') then
    raise exception 'batch1 payment worker result set is incomplete';
  end if;
  if expected_mode='same' then
    if exists (select 1 from public.__test_batch1_worker_results where race=race_key
      and (outcome<>'committed' or classification<>'committed' or sqlstate is not null or error_identifier is not null))
       or (select count(distinct result_id) from public.__test_batch1_worker_results where race=race_key) <> 1 then
      raise exception 'batch1 same-payment worker contract changed';
    end if;
  elsif expected_mode='different' then
    if exists (select 1 from public.__test_batch1_worker_results where race=race_key and worker='first'
         and (outcome is distinct from 'committed'::text or classification is distinct from 'committed'::text
           or sqlstate is not null or error_identifier is not null or payload_identity is distinct from winner_identity))
       or exists (select 1 from public.__test_batch1_worker_results where race=race_key and worker='second'
         and (outcome is distinct from 'rejected'::text or classification is distinct from 'idempotency_payload_mismatch'::text
           or sqlstate is distinct from 'P0001'::text or error_identifier is distinct from 'idempotency_key_payload_mismatch'::text
           or payload_identity is distinct from loser_identity)) then
      raise exception 'batch1 changed-payment deterministic worker contract changed';
    end if;
  else raise exception 'batch1 payment assertion mode is invalid'; end if;
  if exists (select 1 from public.__test_batch1_worker_results where race=race_key
    and fingerprint_classification <> case worker when 'first' then 'winner-canonical-v1'
      else case when expected_mode='same' then 'same-canonical-v1' else 'loser-mismatch' end end) then
    raise exception 'batch1 payment fingerprint classification changed';
  end if;

  select * into payment_row from public.payments
  where organization_id='10000000-0000-4000-8000-000000000000' and idempotency_key=operation_key;
  if payment_row.id is null
     or (select count(*) from public.payments where organization_id=payment_row.organization_id and idempotency_key=operation_key) <> 1
     or payment_row.guardian_id <> '13000000-0000-4000-8000-000000000001'
     or payment_row.amount_minor <> expected_amount or payment_row.method <> 'cash'
     or payment_row.currency_code <> 'MOP' or payment_row.status <> 'received'
     or payment_row.request_fingerprint_version <> 1 then
    raise exception 'batch1 payment winner payload/provenance changed';
  end if;
  expected_fingerprint := public.operation_payload_fingerprint(jsonb_build_object(
    'operation','record_payment','organization_id','10000000-0000-4000-8000-000000000000'::uuid,
    'guardian_id','13000000-0000-4000-8000-000000000001'::uuid,'charge_id',charge_key,
    'amount_minor',expected_amount,'method','cash'));
  if payment_row.request_fingerprint <> expected_fingerprint then
    raise exception 'batch1 payment stored fingerprint does not bind the winner payload';
  end if;
  if (select count(*) from public.payment_allocations where payment_id=payment_row.id
      and charge_id=charge_key and amount_minor=expected_amount) <> 1
     or (select count(*) from public.payment_allocations where payment_id=payment_row.id) <> 1 then
    raise exception 'batch1 payment allocation effect changed';
  end if;
  if (select count(*) from public.receipts where payment_id=payment_row.id
      and amount_minor=expected_amount and guardian_id=payment_row.guardian_id) <> 1 then
    raise exception 'batch1 payment receipt effect changed';
  end if;
  if (select count(*) from public.audit_logs) <> baseline.audit_count+3
     or (select count(*) from public.receipts) <> baseline.receipt_count+1
     or (select count(*) from public.payments) <> baseline.payment_count+1
     or (select count(*) from public.payment_allocations) <> baseline.allocation_count+1
     or (select count(*) from public.notifications) <> baseline.notification_count
     or (select count(*) from public.notification_outbox) <> baseline.outbox_count then
    raise exception 'batch1 payment race side-effect cardinality changed';
  end if;
end
$$;
select 'batch1 payment race: structured worker outcome, deterministic payload binding, and exact effects' as passed;
