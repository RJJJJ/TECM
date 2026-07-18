\set ON_ERROR_STOP on
do $$ begin
  if (select user_id from public.parent_profiles
      where id='93000000-0000-4000-8000-000000000096')
     is distinct from '90000000-0000-4000-8000-000000000096'::uuid then
    raise exception 'two-session invitation race did not preserve the first identity';
  end if;
  if (select count(*) from public.parent_account_invitations
      where parent_profile_id='93000000-0000-4000-8000-000000000096'
        and status='sent')<>1 then
    raise exception 'two-session invitation race created multiple live invitations';
  end if;
end $$;
