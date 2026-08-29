\set ON_ERROR_STOP on

drop table if exists public.__test_race_barrier;
create table public.__test_race_barrier(
  race text not null,
  worker text not null,
  ready_at timestamptz not null default statement_timestamp(),
  released_at timestamptz,
  primary key (race, worker)
);
grant select, insert, update, delete on public.__test_race_barrier to authenticated, service_role;

create or replace function public.__test_race_ready(p_race text, p_worker text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_advisory_lock(hashtextextended('test-race-ready:' || p_race || ':' || p_worker, 0));
end
$$;

create or replace function public.__test_race_ready_count(p_race text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  ready_count integer := 0;
  worker_name text;
  lock_key bigint;
begin
  foreach worker_name in array array['first', 'second'] loop
    lock_key := hashtextextended('test-race-ready:' || p_race || ':' || worker_name, 0);
    if pg_try_advisory_lock(lock_key) then
      perform pg_advisory_unlock(lock_key);
    else
      ready_count := ready_count + 1;
    end if;
  end loop;
  return ready_count;
end
$$;

create or replace function public.__test_race_wait(p_race text, p_worker text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  i integer;
begin
  for i in 1..200 loop
    exit when exists (
      select 1
      from public.__test_race_barrier
      where race = p_race
        and worker = p_worker
        and released_at is not null
    );
    perform pg_sleep(0.1);
  end loop;

  if not exists (
    select 1
    from public.__test_race_barrier
    where race = p_race
      and worker = p_worker
      and released_at is not null
  ) then
    raise exception 'race barrier timed out: %.%', p_race, p_worker;
  end if;
end
$$;

revoke all on function public.__test_race_ready(text, text) from public;
revoke all on function public.__test_race_ready_count(text) from public;
revoke all on function public.__test_race_wait(text, text) from public;
grant execute on function public.__test_race_ready(text, text) to authenticated, service_role;
grant execute on function public.__test_race_wait(text, text) to authenticated, service_role;

update public.parent_profiles
set user_id=null,email=null,account_status='unlinked',invited_at=null,linked_at=null
where id='93000000-0000-4000-8000-000000000096';

delete from public.parent_account_invitations
where parent_profile_id='93000000-0000-4000-8000-000000000096';

delete from public.push_devices
where user_id='90000000-0000-4000-8000-000000000095';

update public.parent_profiles
set account_status='active',linked_at=statement_timestamp()
where id='93000000-0000-4000-8000-000000000095';
