\set ON_ERROR_STOP on

-- Test-local cross-tenant and cancelled-session fixtures.
insert into public.students (id, display_name, status, organization_id)
values ('25000000-0000-4000-8000-000000000001', 'Org B student', 'active', '20000000-0000-4000-8000-000000000000')
on conflict (id) do update set organization_id = excluded.organization_id;

insert into public.teacher_profiles (id, user_id, display_name, is_active, organization_id)
values ('29000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Org B teacher', true, '20000000-0000-4000-8000-000000000000')
on conflict (id) do update set is_active = true;

insert into public.exam_cohorts (
  id, name, subject, level, exam_date, weekday_pattern, lead_teacher_id, status, organization_id
) values (
  '2a000000-0000-4000-8000-000000000001', 'Org B cohort', 'Python', 'Foundation',
  '2027-06-01', 'saturday', '29000000-0000-4000-8000-000000000001', 'active',
  '20000000-0000-4000-8000-000000000000'
) on conflict (id) do update set status = 'active';

insert into public.cohort_students (id, cohort_id, student_id, status, organization_id)
values (
  '2b000000-0000-4000-8000-000000000001', '2a000000-0000-4000-8000-000000000001',
  '25000000-0000-4000-8000-000000000001', 'active', '20000000-0000-4000-8000-000000000000'
) on conflict (cohort_id, student_id) do update set status = 'active';

insert into public.lesson_plans (id, cohort_id, sequence_no, title, organization_id)
values (
  '2c000000-0000-4000-8000-000000000001', '2a000000-0000-4000-8000-000000000001',
  1, 'Org B lesson', '20000000-0000-4000-8000-000000000000'
) on conflict (cohort_id, sequence_no) do update set title = excluded.title;

insert into public.lesson_sessions (
  id, cohort_id, lesson_plan_id, teacher_id, starts_at, ends_at, status, organization_id
) values (
  '2d000000-0000-4000-8000-000000000001', '2a000000-0000-4000-8000-000000000001',
  '2c000000-0000-4000-8000-000000000001', '29000000-0000-4000-8000-000000000001',
  '2027-01-09 09:00:00+08', '2027-01-09 10:00:00+08', 'scheduled',
  '20000000-0000-4000-8000-000000000000'
) on conflict (id) do update set status = 'scheduled';

insert into public.lesson_sessions (
  id, cohort_id, lesson_plan_id, teacher_id, starts_at, ends_at, status, organization_id
) values (
  '1d000000-0000-4000-8000-000000000099', '1a000000-0000-4000-8000-000000000001',
  '1c000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000001',
  '2027-01-10 09:00:00+08', '2027-01-10 10:00:00+08', 'cancelled',
  '10000000-0000-4000-8000-000000000000'
) on conflict (id) do update set status = 'cancelled';

delete from public.attendance_records
where session_id = '1d000000-0000-4000-8000-000000000001'
  and student_id = '15000000-0000-4000-8000-000000000001';

do $$
begin
  if has_function_privilege('anon', 'public.submit_attendance(uuid,jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.get_lesson_session_students(uuid)', 'EXECUTE') then
    raise exception 'anonymous role can execute attendance RPCs';
  end if;
end
$$;

set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', false);

-- Organization A admin succeeds through the real RPC boundary.
select public.submit_attendance(
  '1d000000-0000-4000-8000-000000000001',
  '[{"student_id":"15000000-0000-4000-8000-000000000001","status":"present","internal_note":"rpc test"}]'::jsonb
);

do $$
begin
  if (select organization_id from public.attendance_records
      where session_id = '1d000000-0000-4000-8000-000000000001'
        and student_id = '15000000-0000-4000-8000-000000000001')
     <> '10000000-0000-4000-8000-000000000000'::uuid then
    raise exception 'RPC did not persist the session organization';
  end if;
  if (select coalesce(sum(delta_units), 0) from public.credit_ledger
      where source_type = 'attendance_records'
        and source_id = (select id from public.attendance_records
          where session_id = '1d000000-0000-4000-8000-000000000001'
            and student_id = '15000000-0000-4000-8000-000000000001')) <> -1 then
    raise exception 'first present submission did not deduct exactly one credit';
  end if;
  if not exists (
    select 1 from public.audit_logs
    where table_name = 'attendance_records'
      and actor_user_id = '10000000-0000-4000-8000-000000000001'
      and record_id = (select id::text from public.attendance_records
        where session_id = '1d000000-0000-4000-8000-000000000001'
          and student_id = '15000000-0000-4000-8000-000000000001')
  ) then raise exception 'attendance audit did not preserve the actor user'; end if;
end
$$;

-- Repeating the same status is idempotent.
select public.submit_attendance(
  '1d000000-0000-4000-8000-000000000001',
  '[{"student_id":"15000000-0000-4000-8000-000000000001","status":"present"}]'::jsonb
);

-- present -> absent reverses once; repeating absent does not reverse twice.
select public.submit_attendance(
  '1d000000-0000-4000-8000-000000000001',
  '[{"student_id":"15000000-0000-4000-8000-000000000001","status":"absent"}]'::jsonb
);
select public.submit_attendance(
  '1d000000-0000-4000-8000-000000000001',
  '[{"student_id":"15000000-0000-4000-8000-000000000001","status":"absent"}]'::jsonb
);

do $$
begin
  if (select coalesce(sum(delta_units), 0) from public.credit_ledger
      where source_type = 'attendance_records'
        and source_id = (select id from public.attendance_records
          where session_id = '1d000000-0000-4000-8000-000000000001'
            and student_id = '15000000-0000-4000-8000-000000000001')) <> 0 then
    raise exception 'absent retry returned more or less than one credit';
  end if;
end
$$;

-- absent -> present deducts once; repeating present does not deduct twice.
select public.submit_attendance(
  '1d000000-0000-4000-8000-000000000001',
  '[{"student_id":"15000000-0000-4000-8000-000000000001","status":"present"}]'::jsonb
);
select public.submit_attendance(
  '1d000000-0000-4000-8000-000000000001',
  '[{"student_id":"15000000-0000-4000-8000-000000000001","status":"present"}]'::jsonb
);

do $$
begin
  if (select coalesce(sum(delta_units), 0) from public.credit_ledger
      where source_type = 'attendance_records'
        and source_id = (select id from public.attendance_records
          where session_id = '1d000000-0000-4000-8000-000000000001'
            and student_id = '15000000-0000-4000-8000-000000000001')) <> -1 then
    raise exception 'present retry deducted more or less than one credit';
  end if;
end
$$;

-- Invalid batches fail, and a valid first item is rolled back with the batch.
do $$
begin
  begin
    perform public.submit_attendance(
      '1d000000-0000-4000-8000-000000000001',
      '[{"student_id":"15000000-0000-4000-8000-000000000001","status":"absent"},{"student_id":"15000000-0000-4000-8000-000000000099","status":"present"}]'::jsonb
    );
    raise exception 'mixed valid/invalid batch unexpectedly succeeded';
  exception when others then
    if sqlerrm = 'mixed valid/invalid batch unexpectedly succeeded' then raise; end if;
  end;

  if (select status from public.attendance_records
      where session_id = '1d000000-0000-4000-8000-000000000001'
        and student_id = '15000000-0000-4000-8000-000000000001') <> 'present' then
    raise exception 'mixed batch partially changed attendance';
  end if;

  begin
    perform public.submit_attendance('1d000000-0000-4000-8000-000000000001', '[]'::jsonb);
    raise exception 'empty batch unexpectedly succeeded';
  exception when others then
    if sqlerrm = 'empty batch unexpectedly succeeded' then raise; end if;
  end;

  begin
    perform public.submit_attendance(
      '1d000000-0000-4000-8000-000000000001',
      '[{"student_id":"not-a-uuid","status":"present"}]'::jsonb
    );
    raise exception 'malformed UUID unexpectedly succeeded';
  exception when others then
    if sqlerrm = 'malformed UUID unexpectedly succeeded' then raise; end if;
  end;

  begin
    perform public.submit_attendance(
      '1d000000-0000-4000-8000-000000000001',
      '[{"student_id":"15000000-0000-4000-8000-000000000001","status":"late"}]'::jsonb
    );
    raise exception 'invalid status unexpectedly succeeded';
  exception when others then
    if sqlerrm = 'invalid status unexpectedly succeeded' then raise; end if;
  end;

  begin
    perform public.submit_attendance(
      '1d000000-0000-4000-8000-000000000001',
      '[{"student_id":"15000000-0000-4000-8000-000000000001","status":"present"},{"student_id":"15000000-0000-4000-8000-000000000001","status":"absent"}]'::jsonb
    );
    raise exception 'duplicate student batch unexpectedly succeeded';
  exception when others then
    if sqlerrm = 'duplicate student batch unexpectedly succeeded' then raise; end if;
  end;

  begin
    perform public.submit_attendance(
      '1d000000-0000-4000-8000-000000000099',
      '[{"student_id":"15000000-0000-4000-8000-000000000001","status":"present"}]'::jsonb
    );
    raise exception 'cancelled session unexpectedly accepted attendance';
  exception when others then
    if sqlerrm = 'cancelled session unexpectedly accepted attendance' then raise; end if;
  end;

  begin
    insert into public.audit_logs (organization_id, table_name, record_id, action)
    values ('10000000-0000-4000-8000-000000000000', 'attendance_records', 'forged', 'INSERT');
    raise exception 'authenticated caller forged an audit row';
  exception when insufficient_privilege then null;
  end;
end
$$;

-- Assigned active teacher succeeds and can read the roster.
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', false);
select public.submit_attendance(
  '1d000000-0000-4000-8000-000000000001',
  '[{"student_id":"15000000-0000-4000-8000-000000000001","status":"present"}]'::jsonb
);
do $$ begin
  if (select count(*) from public.get_lesson_session_students('1d000000-0000-4000-8000-000000000001')) < 1 then
    raise exception 'assigned teacher could not read the session roster';
  end if;
end $$;

-- Unassigned teacher is denied both write and read.
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', false);
do $$
begin
  begin
    perform public.submit_attendance(
      '1d000000-0000-4000-8000-000000000001',
      '[{"student_id":"15000000-0000-4000-8000-000000000001","status":"present"}]'::jsonb
    );
    raise exception 'unassigned teacher unexpectedly submitted attendance';
  exception when others then
    if sqlerrm = 'unassigned teacher unexpectedly submitted attendance' then raise; end if;
  end;
  if (select count(*) from public.get_lesson_session_students('1d000000-0000-4000-8000-000000000001')) <> 0 then
    raise exception 'unassigned teacher read the session roster';
  end if;
end
$$;

-- Organization A staff cannot use an Organization B session UUID.
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', false);
do $$
begin
  begin
    perform public.submit_attendance(
      '2d000000-0000-4000-8000-000000000001',
      '[{"student_id":"25000000-0000-4000-8000-000000000001","status":"present"}]'::jsonb
    );
    raise exception 'cross-organization staff attendance unexpectedly succeeded';
  exception when others then
    if sqlerrm = 'cross-organization staff attendance unexpectedly succeeded' then raise; end if;
  end;
  if (select count(*) from public.get_lesson_session_students('2d000000-0000-4000-8000-000000000001')) <> 0 then
    raise exception 'cross-organization staff read the session roster';
  end if;
end
$$;

reset role;
select '006_submit_attendance_rpc: tenant-safe RPC, atomic batches, idempotent ledger, scoped roster, actor audit' as passed;
