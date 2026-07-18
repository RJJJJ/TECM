\set ON_ERROR_STOP on

-- A. Production-like legacy relationship and notification backfill.
do $$ begin
  if (select parent_user_id from public.parent_student_links
      where id='96000000-0000-4000-8000-000000000098')
     is distinct from '90000000-0000-4000-8000-000000000098'::uuid then
    raise exception 'legacy parent/student identity was not backfilled';
  end if;
  if (select recipient_user_id from public.notifications
      where id='94000000-0000-4000-8000-000000000098')
     is distinct from '90000000-0000-4000-8000-000000000098'::uuid then
    raise exception 'legacy notification recipient was not backfilled';
  end if;
end $$;

insert into public.attendance_records(
  id,organization_id,session_id,student_id,status,recorded_by,recorded_at
)
values(
  '98000000-0000-4000-8000-000000000098',
  '10000000-0000-4000-8000-000000000000',
  '1d000000-0000-4000-8000-000000000001',
  '15000000-0000-4000-8000-000000000001','present',
  '10000000-0000-4000-8000-000000000001',statement_timestamp()
)
on conflict (session_id,student_id) do update set status=excluded.status;

set role authenticated;
select set_config('request.jwt.claims','{}',false);
select set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000098',false);
do $$ begin
  if not public.is_parent_of_student('15000000-0000-4000-8000-000000000001') then
    raise exception 'migrated parent cannot resolve own student';
  end if;
  if (select count(*) from public.students where id='15000000-0000-4000-8000-000000000001')<>1 then
    raise exception 'migrated parent cannot read own child/student';
  end if;
  if not exists(select 1 from public.get_parent_lesson_sessions('15000000-0000-4000-8000-000000000001')) then
    raise exception 'migrated parent cannot read lessons';
  end if;
  if not exists(select 1 from public.get_parent_attendance_summary()
      where student_id='15000000-0000-4000-8000-000000000001') then
    raise exception 'migrated parent cannot read attendance';
  end if;
  if not exists(select 1 from public.leave_requests where student_id='15000000-0000-4000-8000-000000000001') then
    raise exception 'migrated parent cannot read leave requests';
  end if;
  if not exists(select 1 from public.charges where student_id='15000000-0000-4000-8000-000000000001') then
    raise exception 'migrated parent cannot read finance';
  end if;
  if (select count(*) from public.notifications where id='94000000-0000-4000-8000-000000000098')<>1 then
    raise exception 'migrated parent cannot read legacy notification';
  end if;
  if exists(select 1 from public.students where organization_id='20000000-0000-4000-8000-000000000000') then
    raise exception 'migrated parent crossed tenant boundary';
  end if;
end $$;
reset role;

-- B. Expired invitations cannot authorize or activate, while resend keeps history.
insert into auth.users(id,email,role) values
  ('90000000-0000-4000-8000-000000000097','expired-parent@tecm.test','authenticated'),
  ('90000000-0000-4000-8000-000000000096','collision-parent-a@tecm.test','authenticated'),
  ('90000000-0000-4000-8000-000000000095','collision-parent-b@tecm.test','authenticated')
on conflict (id) do nothing;

insert into public.parent_profiles(id,organization_id,user_id,full_name,email,account_status,invited_at)
values(
  '93000000-0000-4000-8000-000000000097',
  '10000000-0000-4000-8000-000000000000',
  '90000000-0000-4000-8000-000000000097',
  'Expired Invitation Parent',
  'expired-parent@tecm.test',
  'invited',
  statement_timestamp()-interval '8 days'
)
on conflict (id) do update set account_status='invited',invited_at=excluded.invited_at,linked_at=null;

insert into public.parent_student_links(
  id,organization_id,parent_profile_id,parent_user_id,student_id,relationship,is_primary
)
values(
  '96000000-0000-4000-8000-000000000097',
  '10000000-0000-4000-8000-000000000000',
  '93000000-0000-4000-8000-000000000097',
  '90000000-0000-4000-8000-000000000097',
  '15000000-0000-4000-8000-000000000002',
  'parent',true
)
on conflict (parent_profile_id,student_id) do update set parent_user_id=excluded.parent_user_id;

insert into public.parent_account_invitations(
  id,organization_id,parent_profile_id,email,auth_user_id,status,idempotency_key,invited_by,sent_at,expires_at
)
values(
  '97000000-0000-4000-8000-000000000097',
  '10000000-0000-4000-8000-000000000000',
  '93000000-0000-4000-8000-000000000097',
  'expired-parent@tecm.test',
  '90000000-0000-4000-8000-000000000097',
  'sent','foundation:expired:old','10000000-0000-4000-8000-000000000001',
  statement_timestamp()-interval '8 days',statement_timestamp()-interval '1 day'
);

set role authenticated;
select set_config('request.jwt.claims','{}',false);
select set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000097',false);
do $$ begin
  if public.activate_parent_account() then
    raise exception 'expired invitation activated parent account';
  end if;
  if public.has_parent_account_access('93000000-0000-4000-8000-000000000097') then
    raise exception 'expired invitation retained parent access';
  end if;
  begin
    perform public.register_push_device('expired-install',repeat('a',64),'sandbox','app.TECM','1.0','iPhone');
    raise exception 'expired invitation registered a device';
  exception when others then
    if sqlerrm='expired invitation registered a device' then raise; end if;
  end;
end $$;
reset role;

do $$ begin
  if (select account_status from public.parent_profiles where id='93000000-0000-4000-8000-000000000097')<>'expired' then
    raise exception 'expired profile state was not persisted';
  end if;
  if (select status from public.parent_account_invitations where id='97000000-0000-4000-8000-000000000097')<>'expired' then
    raise exception 'expired invitation audit history was not retained';
  end if;
end $$;

set role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',false);
select public.link_parent_auth_account(
  '10000000-0000-4000-8000-000000000000',
  '93000000-0000-4000-8000-000000000097',
  '90000000-0000-4000-8000-000000000097',
  'expired-parent@tecm.test','foundation:expired:new',
  '10000000-0000-4000-8000-000000000001'
);
reset role;

do $$ begin
  if (select count(*) from public.parent_account_invitations
      where parent_profile_id='93000000-0000-4000-8000-000000000097')<>2 then
    raise exception 'resend replaced invitation history instead of appending';
  end if;
  if not exists(select 1 from public.parent_account_invitations
      where parent_profile_id='93000000-0000-4000-8000-000000000097'
        and idempotency_key='foundation:expired:new' and status='sent'
        and expires_at>statement_timestamp()) then
    raise exception 'resend did not create a fresh DB-time expiry';
  end if;
end $$;

-- C. Linking revalidates the locked profile and immutable idempotency payload.
insert into public.parent_profiles(id,organization_id,full_name,account_status)
values(
  '93000000-0000-4000-8000-000000000096',
  '10000000-0000-4000-8000-000000000000',
  'Concurrent Invitation Parent','unlinked'
)
on conflict (id) do update set user_id=null,email=null,account_status='unlinked';

set role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',false);
select public.link_parent_auth_account(
  '10000000-0000-4000-8000-000000000000','93000000-0000-4000-8000-000000000096',
  '90000000-0000-4000-8000-000000000096','collision-parent-a@tecm.test',
  'foundation:collision:one','10000000-0000-4000-8000-000000000001'
);
do $$ begin
  begin
    perform public.link_parent_auth_account(
      '10000000-0000-4000-8000-000000000000','93000000-0000-4000-8000-000000000096',
      '90000000-0000-4000-8000-000000000095','collision-parent-b@tecm.test',
      'foundation:collision:two','10000000-0000-4000-8000-000000000001');
    raise exception 'second identity overwrote locked parent profile';
  exception when others then
    if sqlerrm='second identity overwrote locked parent profile' then raise; end if;
  end;
  begin
    perform public.link_parent_auth_account(
      '10000000-0000-4000-8000-000000000000','93000000-0000-4000-8000-000000000096',
      '90000000-0000-4000-8000-000000000095','collision-parent-b@tecm.test',
      'foundation:collision:one','10000000-0000-4000-8000-000000000001');
    raise exception 'idempotency key payload was mutable';
  exception when others then
    if sqlerrm='idempotency key payload was mutable' then raise; end if;
  end;
end $$;
reset role;

do $$ begin
  if (select user_id from public.parent_profiles where id='93000000-0000-4000-8000-000000000096')
     is distinct from '90000000-0000-4000-8000-000000000096'::uuid then
    raise exception 'concurrent identity protection did not preserve first writer';
  end if;
end $$;

-- D. A real authenticated staff/RLS context cannot direct-update lifecycle fields.
set role authenticated;
select set_config('request.jwt.claims','{}',false);
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
do $$ begin
  begin
    insert into public.parent_profiles(
      id,organization_id,user_id,full_name,email,account_status,linked_at
    ) values(
      '93000000-0000-4000-8000-000000000094',
      '10000000-0000-4000-8000-000000000000',
      null,
      'Direct DML Parent','direct-dml@tecm.test','active',statement_timestamp()
    );
    raise exception 'staff directly inserted active parent lifecycle state';
  exception when others then
    if sqlerrm='staff directly inserted active parent lifecycle state' then raise; end if;
  end;
  begin
    update public.parent_profiles set account_status='active'
    where id='93000000-0000-4000-8000-000000000097';
    raise exception 'staff directly changed parent account status';
  exception when others then
    if sqlerrm='staff directly changed parent account status' then raise; end if;
  end;
  begin
    update public.parent_profiles set email='mutated@tecm.test'
    where id='93000000-0000-4000-8000-000000000097';
    raise exception 'staff directly changed parent identity email';
  exception when others then
    if sqlerrm='staff directly changed parent identity email' then raise; end if;
  end;
  begin
    update public.parent_account_invitations set status='accepted'
    where id='97000000-0000-4000-8000-000000000097';
    raise exception 'staff directly changed invitation lifecycle';
  exception when others then
    if sqlerrm='staff directly changed invitation lifecycle' then raise; end if;
  end;
end $$;
reset role;

set role authenticated;
select set_config('request.jwt.claims','{}',false);
select set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000098',false);
do $$ begin
  begin
    update public.parent_profiles set email='parent-self-mutation@tecm.test'
    where id='93000000-0000-4000-8000-000000000098';
    raise exception 'active parent directly changed own identity email';
  exception when others then
    if sqlerrm='active parent directly changed own identity email' then raise; end if;
  end;
end $$;
reset role;

-- E. Invalid/blank/null timezones normalize safely.  The legacy-corruption
-- regression below exercises publish_notification_announcement -> notifications
-- -> trg_notifications_enqueue -> enqueue_notification_devices, rather than
-- only the normalization helper.
insert into public.notification_preferences(organization_id,user_id,quiet_hours_start,quiet_hours_end,timezone)
values(
  '10000000-0000-4000-8000-000000000000',
  '90000000-0000-4000-8000-000000000098','00:00','23:59','Asia/Macau'
)
on conflict (organization_id,user_id) do update
set quiet_hours_start='00:00',quiet_hours_end='23:59',timezone='Asia/Macau';

set role authenticated;
select set_config('request.jwt.claims','{}',false);
select set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000098',false);
update public.notification_preferences set timezone='Not/AZone' where user_id=auth.uid();
do $$ begin
  if (select timezone from public.notification_preferences where user_id=auth.uid())<>'Asia/Macau' then
    raise exception 'invalid timezone did not use safe fallback';
  end if;
end $$;
update public.notification_preferences set timezone='   ' where user_id=auth.uid();
update public.notification_preferences set timezone=null where user_id=auth.uid();
reset role;

begin;

-- A second, active recipient proves that one corrupted legacy row cannot
-- prevent fanout to other parents in the same tenant.  The fixed IDs and
-- synthetic tokens are test-only, non-PII fixtures.
insert into auth.users(id,email,role)
values('90000000-0000-4000-8000-000000000094','foundation-timezone-valid@tecm.test','authenticated')
on conflict (id) do nothing;
insert into public.parent_profiles(id,organization_id,user_id,full_name,email,account_status,linked_at)
values(
  '93000000-0000-4000-8000-000000000094',
  '10000000-0000-4000-8000-000000000000',
  '90000000-0000-4000-8000-000000000094',
  'Foundation Timezone Valid Recipient','foundation-timezone-valid@tecm.test','active',statement_timestamp()
)
on conflict (id) do update set account_status='active',linked_at=excluded.linked_at;

insert into public.notification_preferences(organization_id,user_id,quiet_hours_start,quiet_hours_end,timezone)
values
  ('10000000-0000-4000-8000-000000000000','90000000-0000-4000-8000-000000000094','00:00','23:59','Asia/Macau'),
  ('10000000-0000-4000-8000-000000000000','90000000-0000-4000-8000-000000000098','00:00','23:59','Asia/Macau')
on conflict (organization_id,user_id) do update
set quiet_hours_start=excluded.quiet_hours_start,quiet_hours_end=excluded.quiet_hours_end,timezone=excluded.timezone;

insert into public.push_devices(
  organization_id,user_id,installation_id,device_token,environment,bundle_id,is_active
) values
  ('10000000-0000-4000-8000-000000000000','90000000-0000-4000-8000-000000000094',
   'foundation-timezone-valid',repeat('d',64),'sandbox','app.TECM',true),
  ('10000000-0000-4000-8000-000000000000','90000000-0000-4000-8000-000000000098',
   'foundation-timezone-legacy',repeat('e',64),'sandbox','app.TECM',true)
on conflict (user_id,installation_id) do update
set device_token=excluded.device_token,is_active=true,invalidated_at=null;

-- Simulate a pre-migration/corrupt row using a controlled trigger bypass; the
-- trigger is re-enabled before the production publish/fanout path is invoked.
alter table public.notification_preferences disable trigger trg_notification_preferences_validate_timezone;
update public.notification_preferences set timezone='Legacy/Invalid'
where organization_id='10000000-0000-4000-8000-000000000000'
  and user_id='90000000-0000-4000-8000-000000000098';
alter table public.notification_preferences enable trigger trg_notification_preferences_validate_timezone;

set role authenticated;
select set_config('request.jwt.claims','{}',false);
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
do $$ begin
  perform public.publish_notification_announcement(
    '10000000-0000-4000-8000-000000000000',
    'Foundation timezone fanout probe','Synthetic fixture recipients only','announcement',null
  );
exception when others then
  -- This is the Mutation 5 sentinel: direct "AT TIME ZONE np.timezone" makes
  -- the enqueue trigger throw here for Legacy/Invalid and fails the suite.
  raise exception 'legacy invalid timezone rolled back announcement fanout';
end $$;
reset role;

do $$ declare v_announcement_id uuid; begin
  select id into v_announcement_id from public.notification_announcements
  where organization_id='10000000-0000-4000-8000-000000000000'
    and title='Foundation timezone fanout probe';
  if v_announcement_id is null then
    raise exception 'legacy invalid timezone did not persist announcement';
  end if;
  if not exists(
    select 1 from public.notifications n join public.notification_outbox o on o.notification_id=n.id
    where n.organization_id='10000000-0000-4000-8000-000000000000'
      and n.entity_type='announcement' and n.entity_id=v_announcement_id
      and n.recipient_user_id='90000000-0000-4000-8000-000000000094'
  ) then
    raise exception 'legacy invalid timezone prevented valid recipient enqueue';
  end if;
  if not exists(
    select 1 from public.notifications n join public.notification_outbox o on o.notification_id=n.id
    where n.organization_id='10000000-0000-4000-8000-000000000000'
      and n.entity_type='announcement' and n.entity_id=v_announcement_id
      and n.recipient_user_id='90000000-0000-4000-8000-000000000098'
  ) then
    raise exception 'legacy invalid timezone recipient was not safely enqueued';
  end if;
  if exists(
    select 1 from public.notifications n
    where n.entity_type='announcement' and n.entity_id=v_announcement_id
      and n.organization_id<>'10000000-0000-4000-8000-000000000000'
  ) then
    raise exception 'timezone fanout crossed tenant boundary';
  end if;
end $$;

-- Keep this regression self-contained: remove its notifications (and their
-- outbox rows through FK cascade), devices, preferences, and synthetic user.
delete from public.notifications
where entity_type='announcement'
  and entity_id in (
    select id from public.notification_announcements
    where organization_id='10000000-0000-4000-8000-000000000000'
      and title='Foundation timezone fanout probe'
  );
delete from public.notification_announcements
where organization_id='10000000-0000-4000-8000-000000000000'
  and title='Foundation timezone fanout probe';
delete from public.push_devices
where installation_id in ('foundation-timezone-valid','foundation-timezone-legacy');
delete from public.notification_preferences
where organization_id='10000000-0000-4000-8000-000000000000'
  and user_id in ('90000000-0000-4000-8000-000000000094','90000000-0000-4000-8000-000000000098');
delete from public.parent_profiles where id='93000000-0000-4000-8000-000000000094';
delete from auth.users where id='90000000-0000-4000-8000-000000000094';

commit;

-- F. Leave idempotency is non-null, normalized, immutable, requester-bound,
-- and cannot mutate finalized rows.
insert into public.parent_student_links(
  id,organization_id,parent_profile_id,parent_user_id,student_id,relationship,is_primary
)
values(
  '96000000-0000-4000-8000-000000000096',
  '10000000-0000-4000-8000-000000000000',
  '93000000-0000-4000-8000-000000000098',
  '90000000-0000-4000-8000-000000000098',
  '15000000-0000-4000-8000-000000000002','parent',false
)
on conflict (parent_profile_id,student_id) do update set parent_user_id=excluded.parent_user_id;

insert into public.lesson_sessions(
  id,organization_id,cohort_id,lesson_plan_id,teacher_id,starts_at,ends_at,status
)
select
  '1d000000-0000-4000-8000-000000000097',organization_id,cohort_id,lesson_plan_id,teacher_id,
  statement_timestamp()+interval '2 days',statement_timestamp()+interval '2 days 1 hour','scheduled'
from public.lesson_sessions where id='1d000000-0000-4000-8000-000000000001'
on conflict (id) do nothing;

set role authenticated;
select set_config('request.jwt.claims','{}',false);
select set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000098',false);
do $$ declare first_id uuid; replay_id uuid; begin
  begin
    perform public.submit_parent_leave_request(
      '15000000-0000-4000-8000-000000000001','1d000000-0000-4000-8000-000000000098',
      'Fictional appointment',null);
    raise exception 'null leave idempotency key was accepted';
  exception when others then if sqlerrm='null leave idempotency key was accepted' then raise; end if; end;
  begin
    perform public.submit_parent_leave_request(
      '15000000-0000-4000-8000-000000000001','1d000000-0000-4000-8000-000000000098',
      'Fictional appointment','   ');
    raise exception 'blank leave idempotency key was accepted';
  exception when others then if sqlerrm='blank leave idempotency key was accepted' then raise; end if; end;

  first_id:=public.submit_parent_leave_request(
    '15000000-0000-4000-8000-000000000001','1d000000-0000-4000-8000-000000000098',
    'Fictional appointment','  foundation:leave:replay  ');
  replay_id:=public.submit_parent_leave_request(
    '15000000-0000-4000-8000-000000000001','1d000000-0000-4000-8000-000000000098',
    'Fictional appointment','foundation:leave:replay');
  if replay_id<>first_id then raise exception 'exact leave replay returned a different row'; end if;

  begin
    perform public.submit_parent_leave_request(
      '15000000-0000-4000-8000-000000000001','1d000000-0000-4000-8000-000000000098',
      'Changed payload','foundation:leave:replay');
    raise exception 'leave replay changed operation payload';
  exception when others then if sqlerrm='leave replay changed operation payload' then raise; end if; end;
  begin
    perform public.submit_parent_leave_request(
      '15000000-0000-4000-8000-000000000002','1d000000-0000-4000-8000-000000000098',
      'Fictional appointment','foundation:leave:replay');
    raise exception 'leave key crossed student';
  exception when others then if sqlerrm='leave key crossed student' then raise; end if; end;
  begin
    perform public.submit_parent_leave_request(
      '15000000-0000-4000-8000-000000000001','1d000000-0000-4000-8000-000000000097',
      'Fictional appointment','foundation:leave:replay');
    raise exception 'leave key crossed session';
  exception when others then if sqlerrm='leave key crossed session' then raise; end if; end;
end $$;
reset role;

update public.leave_requests set status='approved',decided_at=statement_timestamp()
where organization_id='10000000-0000-4000-8000-000000000000'
  and idempotency_key='foundation:leave:replay';

set role authenticated;
select set_config('request.jwt.claims','{}',false);
select set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000098',false);
select public.submit_parent_leave_request(
  '15000000-0000-4000-8000-000000000001','1d000000-0000-4000-8000-000000000098',
  'Fictional appointment','foundation:leave:replay'
);
do $$ begin
  if not exists(select 1 from public.leave_requests
      where idempotency_key='foundation:leave:replay'
        and status='approved' and reason='Fictional appointment') then
    raise exception 'finalized leave replay mutated the original row';
  end if;
end $$;
reset role;

-- Cross-requester and cross-tenant collisions cannot expose or mutate the row.
insert into public.parent_profiles(id,organization_id,user_id,full_name,email,account_status,linked_at)
values(
  '93000000-0000-4000-8000-000000000095','10000000-0000-4000-8000-000000000000',
  '90000000-0000-4000-8000-000000000095','Same Tenant Other Parent',
  'collision-parent-b@tecm.test','active',statement_timestamp()
)
on conflict (id) do update set account_status='active';
insert into public.parent_student_links(id,organization_id,parent_profile_id,parent_user_id,student_id,relationship,is_primary)
values(
  '96000000-0000-4000-8000-000000000095','10000000-0000-4000-8000-000000000000',
  '93000000-0000-4000-8000-000000000095','90000000-0000-4000-8000-000000000095',
  '15000000-0000-4000-8000-000000000001','parent',false
)
on conflict (parent_profile_id,student_id) do update set parent_user_id=excluded.parent_user_id;

set role authenticated;
select set_config('request.jwt.claims','{}',false);
select set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000095',false);
do $$ begin
  begin
    perform public.submit_parent_leave_request(
      '15000000-0000-4000-8000-000000000001','1d000000-0000-4000-8000-000000000098',
      'Fictional appointment','foundation:leave:replay');
    raise exception 'leave key crossed requester';
  exception when others then if sqlerrm='leave key crossed requester' then raise; end if; end;
end $$;
reset role;

-- G. Device registration requires a separately activated account and cannot leave
-- active installations after disable.
set role authenticated;
select set_config('request.jwt.claims','{}',false);
select set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000097',false);
do $$ begin
  begin
    perform public.register_push_device('invited-install',repeat('c',64),'sandbox','app.TECM','1.0','iPhone');
    raise exception 'invited parent bypassed activation through device registration';
  exception when others then if sqlerrm='invited parent bypassed activation through device registration' then raise; end if; end;
  if not public.activate_parent_account() then raise exception 'valid reissued invitation did not activate'; end if;
  perform public.register_push_device('active-install',repeat('d',64),'sandbox','app.TECM','1.0','iPhone');
end $$;
reset role;

set role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',false);
select public.disable_parent_account(
  '10000000-0000-4000-8000-000000000000','93000000-0000-4000-8000-000000000097'
);
reset role;

do $$ begin
  if exists(select 1 from public.push_devices
      where user_id='90000000-0000-4000-8000-000000000097' and is_active) then
    raise exception 'disabled parent retained active installation';
  end if;
  if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind='S'
        and has_sequence_privilege(
          'authenticated',
          format('%I.%I',n.nspname,c.relname),
          'USAGE'
        )) then
    raise exception 'authenticated retains broad public sequence usage';
  end if;
end $$;

select '008_foundation_security: legacy, expiry, identity, DML, timezone, leave and device invariants' as passed;
