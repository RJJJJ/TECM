\set ON_ERROR_STOP on

insert into auth.users(id,email) values ('30000000-0000-4000-8000-000000000001','unassigned@tecm.test') on conflict do nothing;
insert into public.students(id,display_name,status,organization_id)
values ('25000000-0000-4000-8000-000000000001','Org B student','active','20000000-0000-4000-8000-000000000000')
on conflict (id) do nothing;

set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);

do $$
begin
  if (select count(*) from public.courses where organization_id='20000000-0000-4000-8000-000000000000') <> 0 then
    raise exception 'org A admin can read org B courses';
  end if;
  begin
    insert into public.staff_roles(user_id,role,is_active,organization_id)
    values ('30000000-0000-4000-8000-000000000001','admin',true,'20000000-0000-4000-8000-000000000000');
    raise exception 'cross-org insert unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.charges(organization_id,student_id,description,amount_minor,currency_code,status,idempotency_key)
    values ('10000000-0000-4000-8000-000000000000','25000000-0000-4000-8000-000000000001','Invalid cross tenant charge',100,'MOP','open','cross-tenant-charge');
    raise exception 'cross-org foreign key unexpectedly succeeded';
  exception when check_violation then null;
  end;
end
$$;

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',false);
update public.staff_roles set role='admin' where user_id='10000000-0000-4000-8000-000000000002';
do $$ begin
  if (select role from public.staff_roles where user_id='10000000-0000-4000-8000-000000000002') <> 'staff' then
    raise exception 'staff elevated its own role';
  end if;
end $$;

reset role;
select '002_rls_tenant_isolation: cross-org hidden/write denied; staff elevation denied' as passed;
