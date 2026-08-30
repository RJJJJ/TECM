\set ON_ERROR_STOP on
select set_config('app.test_batch1_idempotency_key', :'idempotency_key', false);
do $$
declare
  operation_key constant text := current_setting('app.test_batch1_idempotency_key');
begin
  if (select count(*) from public.payments where organization_id='10000000-0000-4000-8000-000000000000' and idempotency_key=operation_key) <> 1 then
    raise exception 'batch1 payment race did not persist exactly one payment';
  end if;
  if (select count(*) from public.payment_allocations pa join public.payments p on p.id=pa.payment_id where p.organization_id='10000000-0000-4000-8000-000000000000' and p.idempotency_key=operation_key) <> 1 then
    raise exception 'batch1 payment race did not persist exactly one allocation';
  end if;
  if (select request_fingerprint from public.payments where organization_id='10000000-0000-4000-8000-000000000000' and idempotency_key=operation_key) is null then
    raise exception 'batch1 payment race omitted canonical fingerprint';
  end if;
end
$$;
select 'batch1 payment race: one payment/allocation and canonical fingerprint' as passed;
