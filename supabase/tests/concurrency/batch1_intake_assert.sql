\set ON_ERROR_STOP on
select set_config('app.test_batch1_race', :'race_name', false);
select set_config('app.test_batch1_idempotency_key', :'idempotency_key', false);
select set_config('app.test_batch1_guardian_name', :'winner_guardian_name', false);
select set_config('app.test_batch1_phone', :'winner_phone', false);
select set_config('app.test_batch1_student_name', :'winner_student_name', false);
select set_config('app.test_batch1_loser_student_name', :'loser_student_name', false);
select set_config('app.test_batch1_winner_identity', :'winner_identity', false);
select set_config('app.test_batch1_loser_identity', :'loser_identity', false);
select set_config('app.test_batch1_expected_mode', :'expected_mode', false);
do $$
declare
  race_key constant text := current_setting('app.test_batch1_race');
  operation_key constant text := current_setting('app.test_batch1_idempotency_key');
  guardian_name constant text := current_setting('app.test_batch1_guardian_name');
  guardian_phone constant text := current_setting('app.test_batch1_phone');
  student_name constant text := current_setting('app.test_batch1_student_name');
  loser_student_name constant text := current_setting('app.test_batch1_loser_student_name');
  winner_identity constant text := current_setting('app.test_batch1_winner_identity');
  loser_identity constant text := current_setting('app.test_batch1_loser_identity');
  expected_mode constant text := current_setting('app.test_batch1_expected_mode');
  package_row public.student_packages%rowtype;
  baseline public.__test_batch1_operation_baseline%rowtype;
  expected_fingerprint text;
  winner_student_id uuid;
  winner_parent_id uuid;
  winner_child_id uuid;
begin
  select * into baseline from public.__test_batch1_operation_baseline where race=race_key;
  if baseline.race is null then raise exception 'batch1 intake race baseline missing'; end if;
  if (select count(*) from public.__test_batch1_worker_results where race=race_key) <> 2
     or (select count(distinct worker) from public.__test_batch1_worker_results where race=race_key) <> 2
     or exists (select 1 from public.__test_batch1_worker_results where race=race_key and operation<>'intake') then
    raise exception 'batch1 intake worker result set is incomplete';
  end if;
  if expected_mode='same' then
    if exists (select 1 from public.__test_batch1_worker_results where race=race_key
      and (outcome<>'committed' or classification<>'committed' or sqlstate is not null or error_identifier is not null))
       or (select count(distinct result_id) from public.__test_batch1_worker_results where race=race_key) <> 1 then
      raise exception 'batch1 same-intake worker contract changed';
    end if;
  elsif expected_mode='different' then
    if exists (select 1 from public.__test_batch1_worker_results where race=race_key and worker='first'
         and (outcome is distinct from 'committed'::text or classification is distinct from 'committed'::text
           or sqlstate is not null or error_identifier is not null or payload_identity is distinct from winner_identity))
       or exists (select 1 from public.__test_batch1_worker_results where race=race_key and worker='second'
         and (outcome is distinct from 'rejected'::text or classification is distinct from 'idempotency_payload_mismatch'::text
           or sqlstate is distinct from 'P0001'::text or error_identifier is distinct from 'idempotency_key_payload_mismatch'::text
           or payload_identity is distinct from loser_identity)) then
      raise exception 'batch1 changed-intake deterministic worker contract changed';
    end if;
  else raise exception 'batch1 intake assertion mode is invalid'; end if;
  if exists (select 1 from public.__test_batch1_worker_results where race=race_key
    and fingerprint_classification <> case worker when 'first' then 'winner-canonical-v1'
      else case when expected_mode='same' then 'same-canonical-v1' else 'loser-mismatch' end end) then
    raise exception 'batch1 intake fingerprint classification changed';
  end if;

  select * into package_row from public.student_packages
  where organization_id='10000000-0000-4000-8000-000000000000' and idempotency_key=operation_key;
  winner_student_id := package_row.student_id;
  if package_row.id is null
     or (select count(*) from public.student_packages where organization_id=package_row.organization_id and idempotency_key=operation_key) <> 1
     or package_row.fee_plan_id <> '1e000000-0000-4000-8000-000000000001'
     or package_row.status <> 'active' or package_row.request_fingerprint_version <> 1 then
    raise exception 'batch1 intake winner package/provenance changed';
  end if;
  expected_fingerprint := public.operation_payload_fingerprint(jsonb_build_object(
    'operation','create_guardian_student_enrollment_package','organization_id','10000000-0000-4000-8000-000000000000'::uuid,
    'guardian_name',guardian_name,'guardian_phone',guardian_phone,'student_name',student_name,
    'school_name','Batch1 Race School','cohort_id','1a000000-0000-4000-8000-000000000001'::uuid,
    'fee_plan_id','1e000000-0000-4000-8000-000000000001'::uuid));
  if package_row.request_fingerprint <> expected_fingerprint then
    raise exception 'batch1 intake stored fingerprint does not bind the winner payload';
  end if;
  select psl.parent_profile_id,s.child_id into winner_parent_id,winner_child_id
  from public.parent_student_links psl
  join public.students s on s.id=psl.student_id and s.organization_id=psl.organization_id
  where psl.student_id=winner_student_id;
  if (select count(*) from public.parent_profiles where id=winner_parent_id and full_name=guardian_name and phone=guardian_phone) <> 1
     or (select count(*) from public.children where id=winner_child_id and child_name=student_name and school_name='Batch1 Race School') <> 1
     or (select count(*) from public.students where id=winner_student_id and display_name=student_name) <> 1
     or (select count(*) from public.parent_student_links where parent_profile_id=winner_parent_id and student_id=winner_student_id) <> 1
     or (select count(*) from public.cohort_students where cohort_id='1a000000-0000-4000-8000-000000000001' and student_id=winner_student_id and status='active') <> 1
     or (select count(*) from public.credit_ledger where student_package_id=package_row.id and student_id=winner_student_id and idempotency_key='package:'||operation_key) <> 1
     or (select count(*) from public.charges where student_package_id=package_row.id and student_id=winner_student_id and idempotency_key='charge:'||operation_key) <> 1 then
    raise exception 'batch1 intake winner effect graph changed';
  end if;
  if expected_mode='different' and exists (select 1 from public.students
    where organization_id='10000000-0000-4000-8000-000000000000' and display_name=loser_student_name) then
    raise exception 'batch1 intake loser payload persisted';
  end if;
  if (select count(*) from public.audit_logs) <> baseline.audit_count+6
     or (select count(*) from public.parent_profiles) <> baseline.parent_count+1
     or (select count(*) from public.children) <> baseline.child_count+1
     or (select count(*) from public.students) <> baseline.student_count+1
     or (select count(*) from public.parent_student_links) <> baseline.parent_link_count+1
     or (select count(*) from public.cohort_students) <> baseline.cohort_count+1
     or (select count(*) from public.student_packages) <> baseline.package_count+1
     or (select count(*) from public.credit_ledger) <> baseline.credit_count+1
     or (select count(*) from public.charges) <> baseline.charge_count+1
     or (select count(*) from public.notifications) <> baseline.notification_count
     or (select count(*) from public.notification_outbox) <> baseline.outbox_count then
    raise exception 'batch1 intake race side-effect cardinality changed';
  end if;
end
$$;
select 'batch1 intake race: structured worker outcome, deterministic payload binding, and exact effect graph' as passed;
