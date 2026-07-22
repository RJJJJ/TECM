\set ON_ERROR_STOP on

do $$
declare
  v_function oid := to_regprocedure(
    'public.complete_notification_delivery(uuid,text,text,integer,text)'
  );
  v_dependency text;
begin
  if v_function is null then
    raise exception 'complete_notification_delivery(uuid,text,text,integer,text) is missing';
  end if;

  select format(
      '%s objid=%s objsubid=%s deptype=%s',
      d.classid::regclass::text,
      d.objid::text,
      d.objsubid::text,
      d.deptype::text
    )
    into v_dependency
  from pg_depend d
  where d.refobjid = v_function
    and d.deptype not in ('i','e')
  limit 1;

  if v_dependency is not null then
    raise exception
      'cannot replace complete_notification_delivery while dependent object exists: %',
      v_dependency;
  end if;
end $$;

drop function public.complete_notification_delivery(uuid,text,text,int,text);

create function public.complete_notification_delivery(
  p_outbox_id uuid,
  p_worker_id text,
  p_provider_request_id text,
  p_http_status int,
  p_delivery_status text default 'delivered'
) returns text language plpgsql security definer set search_path=public as $$
declare
  o public.notification_outbox%rowtype;
  d public.push_devices%rowtype;
  n public.notifications%rowtype;
  v_provider_response jsonb;
  v_final_status text;
begin
  if not public.is_service_role() then raise exception 'service role required'; end if;
  if p_delivery_status not in ('delivered','would_send') then raise exception 'invalid delivery status'; end if;
  select * into o from public.notification_outbox where id=p_outbox_id for update;
  if not found then raise exception 'outbox row not found'; end if;
  if o.status not in ('claimed','dispatching') or o.claimed_by<>p_worker_id
    or o.lease_expires_at is null or o.lease_expires_at<=statement_timestamp() then
    raise exception 'outbox lease not owned';
  end if;
  select * into d from public.push_devices where id=o.device_id for update;
  select * into n from public.notifications where id=o.notification_id for update;
  if o.organization_id<>d.organization_id or o.organization_id<>n.organization_id then
    raise exception 'cross-tenant delivery target';
  end if;

  v_provider_response:=jsonb_strip_nulls(jsonb_build_object(
    'provider','apns','provider_request_id',p_provider_request_id,
    'http_status',p_http_status,'apns_request_id',o.apns_request_id
  ));

  if n.expires_at is not null and n.expires_at<=statement_timestamp() then
    v_final_status := 'expired';
    update public.notification_outbox
    set status=v_final_status,lease_expires_at=null,claimed_by=null,
      provider_response=v_provider_response,
      last_error='notification expired before completion',
      updated_at=statement_timestamp()
    where id=o.id;
    insert into public.notification_delivery_attempts(
      organization_id,outbox_id,notification_id,device_id,provider_request_id,
      http_status,result,apns_request_id,device_registration_generation,provider_response
    ) values(
      o.organization_id,o.id,o.notification_id,o.device_id,p_provider_request_id,
      p_http_status,v_final_status,o.apns_request_id,o.device_registration_generation,
      v_provider_response
    );
    return v_final_status;
  end if;

  if not d.is_active or d.invalidated_at is not null
    or o.device_registration_generation is distinct from d.registration_generation then
    v_final_status := 'cancelled';
    update public.notification_outbox
    set status=v_final_status,lease_expires_at=null,claimed_by=null,
      provider_response=v_provider_response,
      last_error='device registration is no longer eligible',
      updated_at=statement_timestamp()
    where id=o.id;
    insert into public.notification_delivery_attempts(
      organization_id,outbox_id,notification_id,device_id,provider_request_id,
      http_status,result,apns_request_id,device_registration_generation,provider_response
    ) values(
      o.organization_id,o.id,o.notification_id,o.device_id,p_provider_request_id,
      p_http_status,v_final_status,o.apns_request_id,o.device_registration_generation,
      v_provider_response
    );
    return v_final_status;
  end if;

  if p_delivery_status='delivered'
    and (o.status<>'dispatching' or o.dispatch_started_at is null) then
    raise exception 'delivered completion requires durable dispatch evidence';
  end if;

  update public.notification_outbox
  set status=p_delivery_status,
      delivered_at=case when p_delivery_status='delivered' then statement_timestamp() else null end,
      lease_expires_at=null,claimed_by=null,provider_response=v_provider_response,
      last_error=null,updated_at=statement_timestamp()
  where id=o.id;
  insert into public.notification_delivery_attempts(
    organization_id,outbox_id,notification_id,device_id,provider_request_id,
    http_status,result,apns_request_id,device_registration_generation,provider_response
  ) values(
    o.organization_id,o.id,o.notification_id,o.device_id,p_provider_request_id,
    p_http_status,p_delivery_status,o.apns_request_id,o.device_registration_generation,
    v_provider_response
  );
  return p_delivery_status;
end $$;

revoke all on function public.complete_notification_delivery(uuid,text,text,int,text)
  from public,anon,authenticated;
grant execute on function public.complete_notification_delivery(uuid,text,text,int,text)
  to service_role;
