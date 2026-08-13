-- Correct Course/Cohort/Enrollment semantics without rewriting legacy rows.
-- A cohort is one delivery of a reusable course. Active membership is unique
-- per student/course, while a student may attend multiple different courses.

drop index if exists public.unique_active_exam_membership;

alter table public.exam_cohorts drop constraint if exists exam_cohorts_subject_check;
alter table public.exam_cohorts drop constraint if exists exam_cohorts_subject_not_blank;
alter table public.exam_cohorts add constraint exam_cohorts_subject_not_blank
  check (length(btrim(subject)) between 1 and 120);

create index if not exists idx_exam_cohorts_organization_course
  on public.exam_cohorts(organization_id, course_id);
create index if not exists idx_cohort_students_active_student
  on public.cohort_students(organization_id, student_id, cohort_id)
  where is_active_membership;

create or replace function public.guard_active_course_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cohort_org uuid;
  cohort_course uuid;
  cohort_state text;
begin
  if new.status <> 'active' then return new; end if;

  select organization_id, course_id, status
  into cohort_org, cohort_course, cohort_state
  from public.exam_cohorts
  where id = new.cohort_id
  for share;

  if cohort_org is null or cohort_org <> new.organization_id then
    raise exception 'enrollment tenant mismatch';
  end if;
  if cohort_course is null then
    raise exception 'cohort course is not linked';
  end if;
  if cohort_state <> 'active' then
    raise exception 'cohort is unavailable for enrollment';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('course-enrollment:' || new.organization_id::text || ':' || new.student_id::text || ':' || cohort_course::text, 0)
  );

  if exists (
    select 1
    from public.cohort_students cs
    join public.exam_cohorts ec
      on ec.id = cs.cohort_id
     and ec.organization_id = cs.organization_id
    where cs.organization_id = new.organization_id
      and cs.student_id = new.student_id
      and cs.is_active_membership
      and ec.course_id = cohort_course
      and cs.id is distinct from new.id
  ) then
    raise exception 'student already has active membership in this course';
  end if;
  return new;
end
$$;

drop trigger if exists trg_guard_active_course_membership on public.cohort_students;
create trigger trg_guard_active_course_membership
before insert or update of organization_id, cohort_id, student_id, status
on public.cohort_students
for each row execute function public.guard_active_course_membership();

create or replace function public.enroll_student_in_cohort(
  target_organization_id uuid,
  target_cohort_id uuid,
  target_student_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cohort_row public.exam_cohorts%rowtype;
  enrollment_row public.cohort_students%rowtype;
  enrollment_id uuid;
  result_status text;
begin
  if not public.can_manage_organization(target_organization_id) then
    raise exception 'manager authorization required';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('student-enrollment:' || target_organization_id::text || ':' || target_student_id::text, 0)
  );

  select * into cohort_row
  from public.exam_cohorts
  where id = target_cohort_id and organization_id = target_organization_id
  for update;
  if cohort_row.id is null then raise exception 'cohort not found'; end if;
  if cohort_row.course_id is null then raise exception 'cohort course is not linked'; end if;
  if cohort_row.status <> 'active' then raise exception 'cohort is unavailable for enrollment'; end if;
  if not exists (
    select 1 from public.courses
    where id = cohort_row.course_id
      and organization_id = target_organization_id
      and is_active
  ) then raise exception 'course is unavailable for enrollment'; end if;

  perform 1 from public.students
  where id = target_student_id
    and organization_id = target_organization_id
    and status = 'active'
  for update;
  if not found then raise exception 'student is unavailable for enrollment'; end if;

  perform pg_advisory_xact_lock(
    hashtextextended('course-enrollment:' || target_organization_id::text || ':' || target_student_id::text || ':' || cohort_row.course_id::text, 0)
  );

  if exists (
    select 1
    from public.cohort_students cs
    join public.exam_cohorts ec on ec.id = cs.cohort_id and ec.organization_id = cs.organization_id
    where cs.organization_id = target_organization_id
      and cs.student_id = target_student_id
      and cs.is_active_membership
      and ec.course_id is null
      and cs.cohort_id <> target_cohort_id
  ) then raise exception 'cohort course is not linked'; end if;

  select * into enrollment_row
  from public.cohort_students
  where organization_id = target_organization_id
    and cohort_id = target_cohort_id
    and student_id = target_student_id
  for update;

  if enrollment_row.id is not null then
    if enrollment_row.status = 'active' and enrollment_row.left_at is null then
      update public.cohort_students set status = 'active', left_at = null
      where id = enrollment_row.id returning id into enrollment_id;
      result_status := 'existing';
    elsif enrollment_row.status in ('withdrawn', 'completed') then
      update public.cohort_students
      set status = 'active', left_at = null, joined_at = current_date
      where id = enrollment_row.id returning id into enrollment_id;
      result_status := 'reactivated';
    else
      raise exception 'completed enrollment cannot be reactivated';
    end if;
  else
    insert into public.cohort_students (
      organization_id, cohort_id, student_id, status, joined_at, left_at
    ) values (
      target_organization_id, target_cohort_id, target_student_id, 'active', current_date, null
    ) returning id into enrollment_id;
    result_status := 'created';
  end if;

  return jsonb_build_object('ok', true, 'enrollment_id', enrollment_id, 'status', result_status);
end
$$;

create or replace function public.transfer_student_between_cohorts(
  target_organization_id uuid,
  target_student_id uuid,
  source_cohort_id uuid,
  target_cohort_id uuid,
  target_confirmed boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  source_cohort public.exam_cohorts%rowtype;
  destination_cohort public.exam_cohorts%rowtype;
  source_membership public.cohort_students%rowtype;
  destination_membership public.cohort_students%rowtype;
  destination_id uuid;
begin
  if not public.can_manage_organization(target_organization_id) then raise exception 'manager authorization required'; end if;
  if target_confirmed is not true then raise exception 'transfer confirmation required'; end if;
  if source_cohort_id = target_cohort_id then raise exception 'transfer cohorts must differ'; end if;

  perform pg_advisory_xact_lock(
    hashtextextended('student-enrollment:' || target_organization_id::text || ':' || target_student_id::text, 0)
  );

  perform 1 from public.students
  where id = target_student_id and organization_id = target_organization_id and status = 'active'
  for update;
  if not found then raise exception 'student is unavailable for transfer'; end if;

  -- Canonical UUID order prevents opposing transfers from deadlocking.
  perform 1 from public.exam_cohorts
  where organization_id = target_organization_id
    and id in (source_cohort_id, target_cohort_id)
  order by id for update;

  select * into source_cohort from public.exam_cohorts
  where id = source_cohort_id and organization_id = target_organization_id;
  select * into destination_cohort from public.exam_cohorts
  where id = target_cohort_id and organization_id = target_organization_id;
  if source_cohort.id is null or destination_cohort.id is null then raise exception 'transfer cohort not found'; end if;
  if source_cohort.course_id is null or destination_cohort.course_id is null then raise exception 'cohort course is not linked'; end if;
  if source_cohort.course_id <> destination_cohort.course_id then raise exception 'transfer cohorts must belong to the same course'; end if;
  if destination_cohort.status <> 'active' then raise exception 'target cohort is unavailable for transfer'; end if;
  if not exists (
    select 1 from public.courses
    where id = source_cohort.course_id and organization_id = target_organization_id and is_active
  ) then raise exception 'course is unavailable for transfer'; end if;

  perform pg_advisory_xact_lock(
    hashtextextended('course-enrollment:' || target_organization_id::text || ':' || target_student_id::text || ':' || source_cohort.course_id::text, 0)
  );

  select * into source_membership from public.cohort_students
  where organization_id = target_organization_id
    and cohort_id = source_cohort_id
    and student_id = target_student_id
  for update;
  if source_membership.id is null or not source_membership.is_active_membership then
    raise exception 'active source enrollment not found';
  end if;

  select * into destination_membership from public.cohort_students
  where organization_id = target_organization_id
    and cohort_id = target_cohort_id
    and student_id = target_student_id
  for update;
  update public.cohort_students
  set status = 'withdrawn', left_at = current_date
  where id = source_membership.id;

  if destination_membership.id is null then
    insert into public.cohort_students (
      organization_id, cohort_id, student_id, status, joined_at, left_at
    ) values (
      target_organization_id, target_cohort_id, target_student_id, 'active', current_date, null
    ) returning id into destination_id;
  else
    update public.cohort_students
    set status = 'active', joined_at = current_date, left_at = null
    where id = destination_membership.id
    returning id into destination_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'source_enrollment_id', source_membership.id,
    'target_enrollment_id', destination_id,
    'status', 'transferred'
  );
end
$$;

create or replace function public.link_cohort_to_course(
  target_organization_id uuid,
  target_cohort_id uuid,
  target_course_id uuid,
  target_confirmed boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cohort_row public.exam_cohorts%rowtype;
  course_row public.courses%rowtype;
begin
  if not public.can_manage_organization(target_organization_id) then raise exception 'manager authorization required'; end if;
  if target_confirmed is not true then raise exception 'course link confirmation required'; end if;

  select * into cohort_row from public.exam_cohorts
  where id = target_cohort_id and organization_id = target_organization_id
  for update;
  if cohort_row.id is null then raise exception 'cohort not found'; end if;

  select * into course_row from public.courses
  where id = target_course_id and organization_id = target_organization_id and is_active
  for share;
  if course_row.id is null then raise exception 'active course not found'; end if;
  if course_row.category is null or btrim(course_row.category) = '' or course_row.level is null or btrim(course_row.level) = '' then
    raise exception 'course data is incomplete for cohort link';
  end if;

  if cohort_row.course_id is not null then
    if cohort_row.course_id = target_course_id then
      return jsonb_build_object('ok', true, 'cohort_id', cohort_row.id, 'course_id', target_course_id, 'status', 'existing');
    end if;
    raise exception 'cohort course is already linked';
  end if;

  perform 1 from public.cohort_students
  where organization_id = target_organization_id and cohort_id = target_cohort_id
  order by student_id for update;

  if exists (
    select 1
    from public.cohort_students legacy_cs
    join public.cohort_students other_cs
      on other_cs.organization_id = legacy_cs.organization_id
     and other_cs.student_id = legacy_cs.student_id
     and other_cs.id <> legacy_cs.id
     and other_cs.is_active_membership
    join public.exam_cohorts other_ec
      on other_ec.id = other_cs.cohort_id
     and other_ec.organization_id = other_cs.organization_id
    where legacy_cs.organization_id = target_organization_id
      and legacy_cs.cohort_id = target_cohort_id
      and legacy_cs.is_active_membership
      and other_ec.course_id = target_course_id
  ) then raise exception 'course link conflicts with active student enrollment'; end if;

  update public.exam_cohorts
  set course_id = target_course_id,
      subject = course_row.category,
      level = course_row.level
  where id = cohort_row.id;

  return jsonb_build_object('ok', true, 'cohort_id', cohort_row.id, 'course_id', target_course_id, 'status', 'linked');
end
$$;

-- Cohort/course changes and enrollment state changes must be attributable.
drop trigger if exists trg_exam_cohorts_audit on public.exam_cohorts;
create trigger trg_exam_cohorts_audit
after insert or update or delete on public.exam_cohorts
for each row execute function public.capture_audit_log();

revoke insert, update, delete on public.cohort_students from authenticated;
revoke all on function public.enroll_student_in_cohort(uuid,uuid,uuid) from public;
revoke all on function public.transfer_student_between_cohorts(uuid,uuid,uuid,uuid,boolean) from public;
revoke all on function public.link_cohort_to_course(uuid,uuid,uuid,boolean) from public;
grant execute on function public.enroll_student_in_cohort(uuid,uuid,uuid) to authenticated;
grant execute on function public.transfer_student_between_cohorts(uuid,uuid,uuid,uuid,boolean) to authenticated;
grant execute on function public.link_cohort_to_course(uuid,uuid,uuid,boolean) to authenticated;
