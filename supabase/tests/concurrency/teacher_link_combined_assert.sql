\set ON_ERROR_STOP on

do $$
declare
  target_a constant uuid := '44000000-0000-4000-8000-000000000001';
  target_b constant uuid := '44000000-0000-4000-8000-000000000002';
  organization_a constant uuid := '10000000-0000-4000-8000-000000000000';
  organization_b constant uuid := '20000000-0000-4000-8000-000000000000';
  target_a_winner_count integer;
  target_a_loser_count integer;
  target_b_winner_count integer;
  target_b_loser_count integer;
  combined_count integer;
begin
  select count(*) into target_a_winner_count
  from public.audit_logs
  where table_name = 'organization_members'
    and action = 'INSERT'
    and new_data->>'user_id' = target_a::text
    and new_data->>'organization_id' = organization_a::text;

  select count(*) into target_a_loser_count
  from public.audit_logs
  where table_name = 'organization_members'
    and action = 'INSERT'
    and new_data->>'user_id' = target_a::text
    and new_data->>'organization_id' = organization_b::text;

  select count(*) into target_b_winner_count
  from public.audit_logs
  where table_name = 'organization_members'
    and action = 'INSERT'
    and new_data->>'user_id' = target_b::text
    and new_data->>'organization_id' = organization_b::text;

  select count(*) into target_b_loser_count
  from public.audit_logs
  where table_name = 'organization_members'
    and action = 'INSERT'
    and new_data->>'user_id' = target_b::text
    and new_data->>'organization_id' = organization_a::text;

  select count(*) into combined_count
  from public.audit_logs
  where table_name = 'organization_members'
    and action = 'INSERT'
    and new_data->>'user_id' in (target_a::text, target_b::text);

  if target_a_winner_count <> 1
     or target_b_winner_count <> 1
     or target_a_loser_count <> 0
     or target_b_loser_count <> 0
     or combined_count <> 2 then
    raise exception 'teacher link combined scenario isolation audit count failure';
  end if;
end
$$;

select 'teacher link combined scenario isolation: two independent winner audits' as passed;
