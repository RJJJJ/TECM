\set ON_ERROR_STOP on
select set_config('app.test_teacher_link_target_user_id', :'target_user_id', false);
select set_config('app.test_teacher_link_expected_winner_organization_id', :'expected_winner_organization_id', false);
select set_config('app.test_teacher_link_expected_loser_organization_id', :'expected_loser_organization_id', false);

do $$
declare
  target_user_id constant uuid := current_setting('app.test_teacher_link_target_user_id')::uuid;
  expected_winner_organization_id constant uuid := current_setting('app.test_teacher_link_expected_winner_organization_id')::uuid;
  expected_loser_organization_id constant uuid := current_setting('app.test_teacher_link_expected_loser_organization_id')::uuid;
  profile_count integer;
  membership_count integer;
  active_teacher_membership_count integer;
  profile_organization_id uuid;
  winner_insert_audit_count integer;
  loser_insert_audit_count integer;
  target_insert_audit_count integer;
begin
  select count(*) into profile_count
  from public.teacher_profiles
  where user_id = target_user_id;
  select organization_id into profile_organization_id
  from public.teacher_profiles
  where user_id = target_user_id;
  if profile_count <> 1 or profile_organization_id <> expected_winner_organization_id then
    raise exception 'teacher link race profile invariant failure';
  end if;

  select
    count(*),
    count(*) filter (
      where organization_id = expected_winner_organization_id
        and role = 'teacher'
        and status = 'active'
    )
  into membership_count, active_teacher_membership_count
  from public.organization_members
  where user_id = target_user_id;
  if membership_count <> 1 or active_teacher_membership_count <> 1 then
    raise exception 'teacher link race membership invariant failure';
  end if;

  if exists (
    select 1 from public.teacher_profiles
    where user_id = target_user_id
      and organization_id = expected_loser_organization_id
  ) or exists (
    select 1 from public.organization_members
    where user_id = target_user_id
      and organization_id = expected_loser_organization_id
  ) then
    raise exception 'teacher link race left cross-tenant partial data';
  end if;

  select count(*) into target_insert_audit_count
  from public.audit_logs
  where table_name = 'organization_members'
    and action = 'INSERT'
    and new_data->>'user_id' = target_user_id::text;

  select count(*) into winner_insert_audit_count
  from public.audit_logs
  where table_name = 'organization_members'
    and action = 'INSERT'
    and new_data->>'user_id' = target_user_id::text
    and new_data->>'organization_id' = expected_winner_organization_id::text;

  select count(*) into loser_insert_audit_count
  from public.audit_logs
  where table_name = 'organization_members'
    and action = 'INSERT'
    and new_data->>'user_id' = target_user_id::text
    and new_data->>'organization_id' = expected_loser_organization_id::text;

  if winner_insert_audit_count = 0 then
    raise exception 'teacher link race winner audit missing';
  end if;
  if loser_insert_audit_count <> 0 then
    raise exception 'teacher link race loser audit residue';
  end if;
  if target_insert_audit_count <> 1 or winner_insert_audit_count <> 1 then
    raise exception 'teacher link race scenario isolation audit count failure';
  end if;

  if exists (
    select 1
    from public.audit_logs
    where table_name = 'organization_members'
    and action = 'INSERT'
    and new_data->>'user_id' = target_user_id::text
      and new_data->>'organization_id' not in (
        expected_winner_organization_id::text,
        expected_loser_organization_id::text
      )
  ) then
    raise exception 'teacher link race scenario isolation audit count failure';
  end if;
end
$$;

select 'teacher link race: one active tenant membership, one profile, and audit integrity' as passed;
