\set ON_ERROR_STOP on

set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);

update public.organizations set low_credit_threshold=9 where id='10000000-0000-4000-8000-000000000000';

insert into public.makeup_entitlements(
  organization_id,student_id,units_granted,units_remaining,status,idempotency_key,created_at
) values (
  '10000000-0000-4000-8000-000000000000','15000000-0000-4000-8000-000000000001',1,1,'available','automation-old-makeup','2026-01-01'
) on conflict (organization_id,idempotency_key) do nothing;

select public.run_automation_job('10000000-0000-4000-8000-000000000000','low_credit','2027-01-09');
select public.run_automation_job('10000000-0000-4000-8000-000000000000','low_credit','2027-01-09');
select public.run_automation_job('10000000-0000-4000-8000-000000000000','overdue_payment','2027-01-09');
select public.run_automation_job('10000000-0000-4000-8000-000000000000','unassigned_makeup','2027-01-09');
select public.run_automation_job('10000000-0000-4000-8000-000000000000','morning_summary','2027-01-09-am');
select public.run_automation_job('10000000-0000-4000-8000-000000000000','evening_summary','2027-01-09-pm');
select public.run_automation_job('10000000-0000-4000-8000-000000000000','weekly_report','2027-W01');
select public.complete_follow_up_task(
  (select id from public.follow_up_tasks where organization_id='10000000-0000-4000-8000-000000000000' and task_type='low_credit' order by id limit 1),
  '已用 WhatsApp 聯絡家長，等待回覆。'
);
select public.complete_follow_up_task(
  (select id from public.follow_up_tasks where organization_id='10000000-0000-4000-8000-000000000000' and task_type='low_credit' order by id limit 1),
  '已用 WhatsApp 聯絡家長，等待回覆。'
);

do $$
begin
  if (select count(*) from public.automation_jobs where organization_id='10000000-0000-4000-8000-000000000000' and job_type='low_credit' and period_key='2027-01-09') <> 1 then
    raise exception 'automation job is not idempotent';
  end if;
  if (select attempt_count from public.automation_jobs where organization_id='10000000-0000-4000-8000-000000000000' and job_type='low_credit' and period_key='2027-01-09') <> 2 then
    raise exception 'automation retry was not recorded';
  end if;
  if (select count(*) from public.follow_up_tasks where organization_id='10000000-0000-4000-8000-000000000000' and task_type='low_credit' and idempotency_key like '2027-01-09:%') < 1 then
    raise exception 'automation follow-up is not idempotent';
  end if;
  if exists (
    select idempotency_key from public.follow_up_tasks
    where organization_id='10000000-0000-4000-8000-000000000000'
      and task_type='low_credit' and idempotency_key like '2027-01-09:%'
    group by idempotency_key having count(*) <> 1
  ) then raise exception 'automation retry duplicated a subject follow-up'; end if;
  if (select count(distinct task_type) from public.follow_up_tasks where organization_id='10000000-0000-4000-8000-000000000000' and task_type in ('low_credit','overdue_payment','unassigned_makeup','morning_summary','evening_summary','weekly_report')) <> 6 then
    raise exception 'not all six automation job families produced human-review tasks';
  end if;
  if (select count(*) from public.audit_logs where organization_id='10000000-0000-4000-8000-000000000000') < 5 then
    raise exception 'expected audit events were not captured';
  end if;
  if (select count(*) from public.communication_logs where organization_id='10000000-0000-4000-8000-000000000000' and idempotency_key like 'follow-up-contact:%') <> 1 then
    raise exception 'follow-up completion did not create exactly one communication outcome';
  end if;
  begin
    delete from public.audit_logs where organization_id='10000000-0000-4000-8000-000000000000';
    raise exception 'audit delete unexpectedly succeeded';
  exception when sqlstate '55000' then null;
  end;
end
$$;

reset role;
select '005_automation_audit: one job and one task per subject across retry; append-only audit populated' as passed;
