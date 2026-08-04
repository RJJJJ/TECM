-- UAT core-workflow hardening for cohort enrollment and existing-parent links.
-- Additive and forward-only: identity uniqueness, tenant triggers, and RLS stay intact.

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
  existing_enrollment public.cohort_students%rowtype;
  enrollment_id uuid;
  result_status text;
begin
  if not public.can_manage_organization(target_organization_id) then
    raise exception 'manager authorization required';
  end if;

  if not exists (
    select 1
    from public.exam_cohorts ec
    left join public.courses c
      on c.id = ec.course_id
      and c.organization_id = ec.organization_id
    where ec.id = target_cohort_id
      and ec.organization_id = target_organization_id
      and ec.status in ('draft', 'active')
      and (ec.course_id is null or c.is_active)
  ) then
    raise exception 'cohort is unavailable for enrollment';
  end if;

  if not exists (
    select 1
    from public.students s
    where s.id = target_student_id
      and s.organization_id = target_organization_id
      and s.status = 'active'
  ) then
    raise exception 'student is unavailable for enrollment';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      target_organization_id::text || ':' || target_cohort_id::text || ':' || target_student_id::text,
      0
    )
  );

  select * into existing_enrollment
  from public.cohort_students
  where organization_id = target_organization_id
    and cohort_id = target_cohort_id
    and student_id = target_student_id
  for update;

  if found then
    if existing_enrollment.status = 'active' and existing_enrollment.left_at is null then
      -- Re-writing the status lets the canonical membership trigger repair a
      -- legacy active row whose derived is_active_membership value is stale.
      update public.cohort_students
      set status = 'active', left_at = null
      where id = existing_enrollment.id
      returning id into enrollment_id;
      result_status := case
        when existing_enrollment.is_active_membership then 'existing'
        else 'reactivated'
      end;
    else
      update public.cohort_students
      set status = 'active', left_at = null, joined_at = current_date
      where id = existing_enrollment.id
      returning id into enrollment_id;
      result_status := 'reactivated';
    end if;
  else
    insert into public.cohort_students (
      organization_id, cohort_id, student_id, status, joined_at, left_at
    ) values (
      target_organization_id, target_cohort_id, target_student_id, 'active', current_date, null
    ) returning id into enrollment_id;
    result_status := 'created';
  end if;

  return jsonb_build_object(
    'ok', true,
    'enrollment_id', enrollment_id,
    'status', result_status
  );
end
$$;

create or replace function public.link_existing_parent_student(
  target_organization_id uuid,
  target_parent_profile_id uuid,
  target_student_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_row public.parent_profiles%rowtype;
  student_row public.students%rowtype;
  existing_link public.parent_student_links%rowtype;
  link_id uuid;
  result_status text;
begin
  if not public.can_manage_organization(target_organization_id) then
    raise exception 'manager authorization required';
  end if;

  select * into parent_row
  from public.parent_profiles
  where id = target_parent_profile_id
    and organization_id = target_organization_id
    and account_status = 'active'
    and user_id is not null
  for update;
  if not found then raise exception 'active parent profile not found'; end if;

  select * into student_row
  from public.students
  where id = target_student_id
    and organization_id = target_organization_id
    and status = 'active'
  for update;
  if not found then raise exception 'active student not found'; end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      target_organization_id::text || ':' || target_parent_profile_id::text || ':' || target_student_id::text,
      0
    )
  );

  select * into existing_link
  from public.parent_student_links
  where parent_profile_id = target_parent_profile_id
    and student_id = target_student_id
  for update;

  if found then
    if existing_link.organization_id <> target_organization_id
      or existing_link.parent_user_id is distinct from parent_row.user_id then
      raise exception 'parent student link identity mismatch';
    end if;
    link_id := existing_link.id;
    result_status := 'existing';
  else
    insert into public.parent_student_links (
      organization_id, parent_profile_id, parent_user_id, student_id,
      relationship, is_primary
    ) values (
      target_organization_id, parent_row.id, parent_row.user_id, student_row.id,
      'parent', true
    ) returning id into link_id;
    result_status := 'created';
  end if;

  return jsonb_build_object('ok', true, 'link_id', link_id, 'status', result_status);
end
$$;

create or replace function public.unlink_existing_parent_student(
  target_organization_id uuid,
  target_link_id uuid,
  target_confirmed boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  link_row public.parent_student_links%rowtype;
begin
  if not public.can_manage_organization(target_organization_id) then
    raise exception 'manager authorization required';
  end if;
  if target_confirmed is not true then raise exception 'link removal confirmation required'; end if;

  select psl.* into link_row
  from public.parent_student_links psl
  join public.parent_profiles pp
    on pp.id = psl.parent_profile_id
    and pp.organization_id = psl.organization_id
  join public.students s
    on s.id = psl.student_id
    and s.organization_id = psl.organization_id
  where psl.id = target_link_id
    and psl.organization_id = target_organization_id
  for update of psl;
  if not found then raise exception 'parent student link not found'; end if;

  delete from public.parent_student_links
  where id = link_row.id
    and organization_id = target_organization_id;
  return true;
end
$$;

-- Parent/student relationship writes must use the guarded workflow. Parent
-- reads and all existing tenant/RLS restrictions remain unchanged.
revoke insert, update, delete on public.parent_student_links from authenticated;

-- The legacy audit trigger set covered enrollments but omitted relationship
-- changes. Install it explicitly so confirmed link removals are attributable.
drop trigger if exists trg_parent_student_links_audit on public.parent_student_links;
create trigger trg_parent_student_links_audit
after insert or update or delete on public.parent_student_links
for each row execute function public.capture_audit_log();

revoke all on function public.enroll_student_in_cohort(uuid,uuid,uuid) from public;
revoke all on function public.link_existing_parent_student(uuid,uuid,uuid) from public;
revoke all on function public.unlink_existing_parent_student(uuid,uuid,boolean) from public;
grant execute on function public.enroll_student_in_cohort(uuid,uuid,uuid) to authenticated;
grant execute on function public.link_existing_parent_student(uuid,uuid,uuid) to authenticated;
grant execute on function public.unlink_existing_parent_student(uuid,uuid,boolean) to authenticated;
