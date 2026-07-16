\set ON_ERROR_STOP on

do $$ begin
  if not exists(
    select 1 from public.parent_profiles
    where id='93000000-0000-4000-8000-000000000099'
      and user_id='90000000-0000-4000-8000-000000000099'
      and account_status='active'
      and linked_at is not null
  ) then
    raise exception 'migration did not preserve an existing linked parent account';
  end if;
end $$;

-- Staff creates an auditable, idempotent invitation record and a notification.
update public.parent_profiles
set account_status='invited',linked_at=null
where id='13000000-0000-4000-8000-000000000001';

set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
insert into public.parent_account_invitations(
  organization_id,parent_profile_id,email,auth_user_id,status,idempotency_key,invited_by,sent_at
) values (
  '10000000-0000-4000-8000-000000000000','13000000-0000-4000-8000-000000000001',
  'guardian-a@tecm.test','10000000-0000-4000-8000-000000000003','sent','invite:guardian-a',
  '10000000-0000-4000-8000-000000000001',now()
) on conflict(organization_id,idempotency_key) do update set sent_at=excluded.sent_at,status='sent';

do $$ begin
  begin
    insert into public.parent_account_invitations(organization_id,parent_profile_id,email,auth_user_id,status,idempotency_key)
    values('20000000-0000-4000-8000-000000000000','13000000-0000-4000-8000-000000000001','bad@tecm.test','10000000-0000-4000-8000-000000000003','sent','bad-tenant');
    raise exception 'cross-tenant invitation was accepted';
  exception when others then if sqlerrm='cross-tenant invitation was accepted' then raise; end if; end;
  begin
    insert into public.parent_account_invitations(organization_id,parent_profile_id,email,auth_user_id,status,idempotency_key)
    values('10000000-0000-4000-8000-000000000000','13000000-0000-4000-8000-000000000001','bad@tecm.test','10000000-0000-4000-8000-000000000002','sent','bad-user');
    raise exception 'wrong auth user invitation was accepted';
  exception when others then if sqlerrm='wrong auth user invitation was accepted' then raise; end if; end;
end $$;

insert into public.lesson_sessions(
  id,organization_id,cohort_id,lesson_plan_id,teacher_id,starts_at,ends_at,status
)
select
  '1d000000-0000-4000-8000-000000000098',organization_id,cohort_id,lesson_plan_id,teacher_id,
  now()+interval '1 day',now()+interval '1 day 1 hour','scheduled'
from public.lesson_sessions where id='1d000000-0000-4000-8000-000000000001';

insert into public.notifications(
  organization_id,parent_id,recipient_user_id,category,title,body,deep_link,event_key,source
) values (
  '10000000-0000-4000-8000-000000000000','13000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000003','booking','Booking confirmed','Your class is confirmed',
  'tecm://bookings/aaaaaaaa-0000-4000-8000-000000000001','test:event:1','test'
) on conflict do nothing;
insert into public.notifications(organization_id,parent_id,recipient_user_id,category,title,body,event_key,source)
values('10000000-0000-4000-8000-000000000000','13000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','transactional','Second notice','Body','test:event:read-all','test');

-- Linked parent is a tenant principal without an organization_members row.
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',false);
select public.activate_parent_account();
do $$ begin
  if (select account_status from public.parent_profiles where user_id=auth.uid())<>'active' then
    raise exception 'authenticated parent session did not activate the account independently of push registration';
  end if;
  if not exists(
    select 1 from public.parent_account_invitations
    where auth_user_id=auth.uid() and status='accepted' and accepted_at is not null
  ) then
    raise exception 'authenticated parent session did not accept the invitation audit';
  end if;
  if exists(select 1 from public.organization_members where user_id=auth.uid()) then
    raise exception 'parent was exposed as organization member';
  end if;
  if (select count(*) from public.students where id='15000000-0000-4000-8000-000000000001')<>1 then
    raise exception 'parent cannot read own student';
  end if;
  if (select count(*) from public.students where organization_id='20000000-0000-4000-8000-000000000000')<>0 then
    raise exception 'parent can read another tenant';
  end if;
  if not exists(select 1 from public.get_parent_lesson_sessions('15000000-0000-4000-8000-000000000001') where session_id='1d000000-0000-4000-8000-000000000098') then
    raise exception 'parent session list omitted an enrolled future class';
  end if;
  if exists(select 1 from public.get_parent_lesson_sessions('15000000-0000-4000-8000-000000000001') where session_id='1d000000-0000-4000-8000-000000000002') then
    raise exception 'parent session list exposed another cohort';
  end if;
  begin
    insert into public.leave_requests(
      organization_id,student_id,lesson_session_id,requested_by,reason,status,idempotency_key
    ) values(
      '10000000-0000-4000-8000-000000000000','15000000-0000-4000-8000-000000000001',
      '1d000000-0000-4000-8000-000000000002',auth.uid(),'direct bypass','approved','leave:direct-bypass'
    );
    raise exception 'parent bypassed leave RPC validation with a direct insert';
  exception when others then
    if sqlerrm='parent bypassed leave RPC validation with a direct insert' then raise; end if;
  end;
  begin
    perform public.submit_parent_leave_request(
      '15000000-0000-4000-8000-000000000001','1d000000-0000-4000-8000-000000000002','invalid session','leave:invalid-session'
    );
    raise exception 'leave request accepted a session outside the student cohort';
  exception when others then
    if sqlerrm='leave request accepted a session outside the student cohort' then raise; end if;
  end;
  perform public.submit_parent_leave_request(
    '15000000-0000-4000-8000-000000000001','1d000000-0000-4000-8000-000000000098','family appointment','leave:valid-session'
  );
  if public.get_unread_notification_count()<>2 then raise exception 'unread count is incorrect'; end if;
  begin
    update public.parent_profiles set account_status='disabled' where user_id=auth.uid();
    raise exception 'parent changed server-controlled account status';
  exception when others then
    if sqlerrm='parent changed server-controlled account status' then raise; end if;
  end;
end $$;

do $$ begin
  begin
    perform public.register_push_device('ios-install-a','not-a-valid-token','sandbox','app.TECM','1.0','iPhone');
    raise exception 'invalid APNs token was accepted';
  exception when others then
    if sqlerrm='invalid APNs token was accepted' then raise; end if;
  end;
  begin
    perform public.register_push_device('ios-install-a',repeat('a',64),'staging','app.TECM','1.0','iPhone');
    raise exception 'invalid APNs environment was accepted';
  exception when others then
    if sqlerrm='invalid APNs environment was accepted' then raise; end if;
  end;
end $$;
select public.register_push_device('ios-install-a',repeat('a',64),'sandbox','app.TECM','1.0','iPhone');
select public.register_push_device('ios-install-a',repeat('b',64),'sandbox','app.TECM','1.1','iPhone');
do $$ begin
  if (select count(*) from public.push_devices where user_id=auth.uid() and installation_id='ios-install-a')<>1 then
    raise exception 'push registration is not idempotent';
  end if;
  if exists(select 1 from public.push_devices where user_id=auth.uid() and organization_id<>'10000000-0000-4000-8000-000000000000') then
    raise exception 'push registration did not derive the tenant from the authenticated parent';
  end if;
  if (select account_status from public.parent_profiles where user_id=auth.uid())<>'active' then
    raise exception 'push registration changed an active parent account unexpectedly';
  end if;
  begin
    update public.notification_preferences set user_id='10000000-0000-4000-8000-000000000002' where user_id=auth.uid();
    raise exception 'notification preference principal was mutable';
  exception when others then
    if sqlerrm='notification preference principal was mutable' then raise; end if;
  end;
  if not public.mark_notification_read((select id from public.notifications where event_key='test:event:1')) then
    raise exception 'mark read failed';
  end if;
  if public.mark_all_notifications_read()<>1 then raise exception 'mark all read count was incorrect'; end if;
  if public.get_unread_notification_count()<>0 then raise exception 'read state was not persisted'; end if;
end $$;

-- A second event enqueues exactly one row for the active installation.
reset role;
insert into public.notifications(
  organization_id,parent_id,recipient_user_id,category,title,body,event_key,source
) values (
  '10000000-0000-4000-8000-000000000000','13000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000003','announcement','Test announcement','Body','test:event:2','test'
);
insert into public.notifications(organization_id,parent_id,recipient_user_id,category,title,body,event_key,source)
values('10000000-0000-4000-8000-000000000000','13000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','announcement','Test announcement','Body','test:event:2','test')
on conflict do nothing;
insert into public.notifications(organization_id,parent_id,recipient_user_id,category,title,body,event_key,source)
values
('10000000-0000-4000-8000-000000000000','13000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','marketing','Marketing off','Body','test:marketing:off','test'),
('10000000-0000-4000-8000-000000000000','13000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','announcement','Announcement on','Body','test:announcement:on','test');
do $$ begin
  if (select count(*) from public.notification_outbox o join public.notifications n on n.id=o.notification_id where n.event_key='test:event:2')<>1 then
    raise exception 'notification did not enqueue exactly one active device';
  end if;
  if (select count(*) from public.notifications where event_key='test:event:2')<>1 then raise exception 'event retry duplicated notification'; end if;
  if exists(select 1 from public.notification_outbox o join public.notifications n on n.id=o.notification_id where n.event_key='test:marketing:off') then raise exception 'disabled marketing preference was ignored'; end if;
  if (select count(*) from public.notification_outbox o join public.notifications n on n.id=o.notification_id where n.event_key='test:announcement:on')<>1 then raise exception 'enabled announcement preference was ignored'; end if;
end $$;

set role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',false);
select * from public.claim_notification_outbox('worker-a',25,60);
select * from public.claim_notification_outbox('worker-other',25,60);
do $$ declare v_id uuid; begin
  select o.id into v_id from public.notification_outbox o join public.notifications n on n.id=o.notification_id
    where n.event_key='test:event:2' and o.claimed_by='worker-a';
  if v_id is null then raise exception 'atomic claim returned no row'; end if;
  if (select claimed_by from public.notification_outbox where id=v_id)<>'worker-a' then raise exception 'second worker stole an active lease'; end if;
  perform public.complete_notification_delivery(v_id,'worker-a','dry-run',200,'would_send');
  if (select status from public.notification_outbox where id=v_id)<>'would_send' then raise exception 'dry run was marked delivered'; end if;
  if (select delivered_at from public.notification_outbox where id=v_id) is not null then raise exception 'dry run received a delivered timestamp'; end if;
end $$;
update public.notification_outbox o set lease_expires_at=now()-interval '1 second'
from public.notifications n where n.id=o.notification_id and n.event_key='test:announcement:on' and o.claimed_by='worker-a';
select * from public.claim_notification_outbox('worker-recovery',25,60);
do $$ begin if not exists(select 1 from public.notification_outbox o join public.notifications n on n.id=o.notification_id where n.event_key='test:announcement:on' and o.claimed_by='worker-recovery') then raise exception 'expired lease was not recovered'; end if; end $$;
reset role;

-- Retry/dead-letter and invalid-token handling.
insert into public.notifications(
  organization_id,parent_id,recipient_user_id,category,title,body,event_key,source
) values (
  '10000000-0000-4000-8000-000000000000','13000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000003','payments','Payment receipt','Receipt ready','test:event:3','test'
);
set role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',false);
select * from public.claim_notification_outbox('worker-b',25,60);
do $$ declare v_id uuid; begin
  select o.id into v_id from public.notification_outbox o join public.notifications n on n.id=o.notification_id
    where n.event_key='test:event:3' and o.claimed_by='worker-b';
  if public.retry_notification_delivery(v_id,'worker-b',503,'Unavailable',true,false)<>'retry' then raise exception 'retryable delivery did not enter retry'; end if;
  if (select available_at from public.notification_outbox where id=v_id)<=now() then raise exception 'retry backoff was not scheduled'; end if;
  update public.notification_outbox set available_at=now()-interval '1 second',attempt_count=8 where id=v_id;
  perform public.claim_notification_outbox('worker-max',25,60);
  if public.retry_notification_delivery(v_id,'worker-max',410,'Unregistered',true,true)<>'dead_letter' then raise exception 'max-attempt delivery was not dead-lettered'; end if;
  if exists(select 1 from public.push_devices where installation_id='ios-install-a' and is_active) then
    raise exception 'invalid APNs device remained active';
  end if;
end $$;
reset role;

do $$ begin
  if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any(array['parent_account_invitations','push_devices','notification_preferences','notification_announcements','notification_templates','notification_outbox','notification_delivery_attempts','receipts']) and not c.relforcerowsecurity) then raise exception 'new public table missing FORCE RLS'; end if;
end $$;

-- Disabling a linked account must revoke every parent data path, not only push registration.
set role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',false);
select public.disable_parent_account(
  '10000000-0000-4000-8000-000000000000','13000000-0000-4000-8000-000000000001'
);
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',false);
do $$ begin
  if exists(select 1 from public.parent_profiles where user_id=auth.uid()) then raise exception 'disabled parent can read own profile'; end if;
  if exists(select 1 from public.students where id='15000000-0000-4000-8000-000000000001') then raise exception 'disabled parent can read student data'; end if;
  if exists(select 1 from public.notifications where recipient_user_id=auth.uid()) then raise exception 'disabled parent can read notifications'; end if;
  if exists(select 1 from public.get_parent_attendance_summary()) then raise exception 'disabled parent can read attendance summary'; end if;
  if public.get_unread_notification_count()<>0 then raise exception 'disabled parent can read unread count'; end if;
  if public.mark_all_notifications_read()<>0 then raise exception 'disabled parent can mutate notifications'; end if;
end $$;
reset role;
do $$ begin
  if exists(select 1 from public.push_devices where user_id='10000000-0000-4000-8000-000000000003' and is_active) then
    raise exception 'atomic account disable left an active push device';
  end if;
  if exists(select 1 from public.parent_account_invitations where parent_profile_id='13000000-0000-4000-8000-000000000001' and status<>'disabled') then
    raise exception 'atomic account disable left an enabled invitation';
  end if;
end $$;

select '007_parent_notifications: parent tenant access/revocation, invitation, device rotation, read state, atomic claim, would_send, dead-letter and invalidation' as passed;
