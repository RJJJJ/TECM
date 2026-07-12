\set ON_ERROR_STOP on

insert into public.students(id,display_name,status,organization_id)
values ('15000000-0000-4000-8000-000000000099','Not Enrolled','active','10000000-0000-4000-8000-000000000000')
on conflict (id) do nothing;

set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);

do $$
begin
  begin
    insert into public.attendance_records(id,organization_id,session_id,student_id,status)
    values ('31000000-0000-4000-8000-000000000099','10000000-0000-4000-8000-000000000000','1d000000-0000-4000-8000-000000000001','15000000-0000-4000-8000-000000000099','present');
    raise exception 'non-enrolled attendance unexpectedly succeeded';
  exception when others then
    if sqlerrm = 'non-enrolled attendance unexpectedly succeeded' then raise; end if;
  end;
end
$$;

insert into public.attendance_records(id,organization_id,session_id,student_id,status,recorded_by)
values ('31000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000000','1d000000-0000-4000-8000-000000000001','15000000-0000-4000-8000-000000000001','present','10000000-0000-4000-8000-000000000001')
on conflict (session_id,student_id) do update set status=excluded.status;
update public.attendance_records set status='present' where id='31000000-0000-4000-8000-000000000001';

do $$ begin
  if (select count(*) from public.credit_ledger where idempotency_key='attendance:31000000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'attendance credit deduction is not idempotent';
  end if;
end $$;

update public.attendance_records set status='absent' where id='31000000-0000-4000-8000-000000000001';
update public.attendance_records set status='absent' where id='31000000-0000-4000-8000-000000000001';
do $$ begin
  if (select coalesce(sum(delta_units),0) from public.credit_ledger where source_type='attendance_records' and source_id='31000000-0000-4000-8000-000000000001') <> 0 then
    raise exception 'attendance correction did not return exactly one credit';
  end if;
end $$;
update public.attendance_records set status='present' where id='31000000-0000-4000-8000-000000000001';
update public.attendance_records set status='present' where id='31000000-0000-4000-8000-000000000001';
do $$ begin
  if (select coalesce(sum(delta_units),0) from public.credit_ledger where source_type='attendance_records' and source_id='31000000-0000-4000-8000-000000000001') <> -1 then
    raise exception 'attendance correction did not re-deduct exactly one credit';
  end if;
end $$;

insert into public.leave_requests(id,organization_id,student_id,lesson_session_id,requested_by,reason,idempotency_key)
values ('32000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000000','15000000-0000-4000-8000-000000000001','1d000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','Family leave','leave-test-1')
on conflict (organization_id,idempotency_key) do nothing;
select public.decide_leave_request('32000000-0000-4000-8000-000000000001','approved');
select public.decide_leave_request('32000000-0000-4000-8000-000000000001','approved');

do $$ begin
  if (select count(*) from public.makeup_entitlements where leave_request_id='32000000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'leave approval did not create exactly one entitlement';
  end if;
end $$;

select public.book_makeup_session(
  '10000000-0000-4000-8000-000000000000',
  (select id from public.makeup_entitlements where leave_request_id='32000000-0000-4000-8000-000000000001'),
  '19000000-0000-4000-8000-000000000001','2027-01-10 09:00:00+08','makeup-booking-1'
);
select public.book_makeup_session(
  '10000000-0000-4000-8000-000000000000',
  (select id from public.makeup_entitlements where leave_request_id='32000000-0000-4000-8000-000000000001'),
  '19000000-0000-4000-8000-000000000001','2027-01-10 09:00:00+08','makeup-booking-1'
);

do $$ begin
  if (select count(*) from public.makeup_sessions where idempotency_key='makeup-booking-1') <> 1 then
    raise exception 'makeup booking is not idempotent';
  end if;
  if (select status from public.makeup_entitlements where leave_request_id='32000000-0000-4000-8000-000000000001') <> 'reserved' then
    raise exception 'makeup entitlement was not reserved';
  end if;
  if (select count(*) from public.communication_logs
      where organization_id='10000000-0000-4000-8000-000000000000'
        and idempotency_key in ('leave-approved:32000000-0000-4000-8000-000000000001',
                                'makeup-booked:' || (select id::text from public.makeup_entitlements where leave_request_id='32000000-0000-4000-8000-000000000001'))) <> 2 then
    raise exception 'leave and makeup did not create two idempotent manual message drafts';
  end if;
end $$;

reset role;
select '003_attendance_leave_makeup: enrollment guard, idempotent debit/reversal, 1 entitlement, 1 booking, 2 message drafts' as passed;
