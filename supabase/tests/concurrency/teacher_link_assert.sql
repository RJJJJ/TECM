\set ON_ERROR_STOP on
do $$
declare
  target_user_id constant uuid := '44000000-0000-4000-8000-000000000001';
  organization_a constant uuid := '10000000-0000-4000-8000-000000000000';
  organization_b constant uuid := '20000000-0000-4000-8000-000000000000';
  winning_organization_id uuid;
begin
  if (select count(*) from public.teacher_profiles where user_id = target_user_id) <> 1 then
    raise exception 'teacher link race created multiple profiles';
  end if;

  select organization_id into winning_organization_id
  from public.teacher_profiles
  where user_id = target_user_id;
  if winning_organization_id not in (organization_a, organization_b) then
    raise exception 'teacher link race selected an unexpected organization';
  end if;

  if (select count(*) from public.organization_members where user_id = target_user_id) <> 1
     or not exists (
       select 1 from public.organization_members
       where user_id = target_user_id
         and organization_id = winning_organization_id
         and role = 'teacher'
         and status = 'active'
     ) then
    raise exception 'teacher link race did not leave exactly one active teacher membership';
  end if;

  if exists (
    select 1 from public.teacher_profiles
    where user_id = target_user_id
      and organization_id <> winning_organization_id
  ) or exists (
    select 1 from public.organization_members
    where user_id = target_user_id
      and organization_id <> winning_organization_id
  ) then
    raise exception 'teacher link race left cross-tenant partial data';
  end if;

  if not exists (
    select 1 from public.audit_logs
    where table_name = 'organization_members'
      and action = 'INSERT'
      and new_data->>'user_id' = target_user_id::text
      and new_data->>'organization_id' = winning_organization_id::text
  ) then
    raise exception 'teacher link race audit integrity is incorrect';
  end if;
end
$$;

select 'teacher link race: one active tenant membership, one profile, and audit integrity' as passed;
