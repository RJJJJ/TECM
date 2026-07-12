\set ON_ERROR_STOP on

set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);

select public.create_guardian_student_enrollment_package(
  '10000000-0000-4000-8000-000000000000','Guardian New','+85360000002','Student New','TECM School',
  '1a000000-0000-4000-8000-000000000001','1e000000-0000-4000-8000-000000000001','enrollment-new-1'
);
select public.create_guardian_student_enrollment_package(
  '10000000-0000-4000-8000-000000000000','Guardian New','+85360000002','Student New','TECM School',
  '1a000000-0000-4000-8000-000000000001','1e000000-0000-4000-8000-000000000001','enrollment-new-1'
);

insert into public.charges(id,organization_id,student_id,student_package_id,description,amount_minor,currency_code,status,idempotency_key)
values ('41000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000000','15000000-0000-4000-8000-000000000001','1f000000-0000-4000-8000-000000000001','January tuition',250000,'MOP','open','charge-jan-a')
on conflict (organization_id,idempotency_key) do nothing;

select public.record_payment('10000000-0000-4000-8000-000000000000','13000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001',250000,'cash','payment-jan-a');
select public.record_payment('10000000-0000-4000-8000-000000000000','13000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001',250000,'cash','payment-jan-a');

insert into public.charges(id,organization_id,student_id,student_package_id,description,amount_minor,currency_code,status,idempotency_key)
values ('41000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000000','15000000-0000-4000-8000-000000000001','1f000000-0000-4000-8000-000000000001','Partial tuition',300000,'MOP','open','charge-partial-a')
on conflict (organization_id,idempotency_key) do nothing;
select public.record_payment('10000000-0000-4000-8000-000000000000','13000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000002',100000,'cash','payment-partial-a');

do $$
begin
  if (select count(*) from public.student_packages where idempotency_key='enrollment-new-1') <> 1
     or (select count(*) from public.credit_ledger where idempotency_key='package:enrollment-new-1') <> 1
     or (select count(*) from public.charges where idempotency_key='charge:enrollment-new-1') <> 1 then
    raise exception 'enrollment/package/charge transaction is not idempotent';
  end if;
  if (select count(*) from public.payments where idempotency_key='payment-jan-a') <> 1
     or (select count(*) from public.payment_allocations pa join public.payments p on p.id=pa.payment_id where p.idempotency_key='payment-jan-a') <> 1 then
    raise exception 'payment/allocation is not idempotent';
  end if;
  if (select status from public.charges where id='41000000-0000-4000-8000-000000000001') <> 'paid' then
    raise exception 'charge not marked paid';
  end if;
  if (select c.amount_minor-coalesce(sum(pa.amount_minor),0) from public.charges c left join public.payment_allocations pa on pa.charge_id=c.id where c.id='41000000-0000-4000-8000-000000000002' group by c.id) <> 200000
     or (select status from public.charges where id='41000000-0000-4000-8000-000000000002') <> 'partially_paid' then
    raise exception 'outstanding amount calculation is incorrect';
  end if;
  begin
    update public.credit_ledger set delta_units=99 where idempotency_key='seed:package-a';
    raise exception 'ledger update unexpectedly succeeded';
  exception when sqlstate '55000' then null;
  end;
end
$$;

reset role;
select '004_finance_ledger: bigint payments, outstanding balance, idempotency, immutable credit ledger' as passed;
