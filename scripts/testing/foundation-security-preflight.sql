\set ON_ERROR_STOP on

-- Read-only preflight for 202607180005_foundation_security.sql.
-- A false safe_to_apply result blocks the migration until the reported legacy
-- conflicts are investigated and corrected with an organization-scoped plan.
with counts as (
  select
    (select count(*) from public.parent_student_links psl
     join public.parent_profiles pp on pp.id=psl.parent_profile_id
     join public.students s on s.id=psl.student_id
     where psl.parent_user_id is null and pp.user_id is not null
       and psl.organization_id=pp.organization_id
       and psl.organization_id=s.organization_id) as inferable_parent_links,
    (select count(*) from public.parent_student_links psl
     join public.parent_profiles pp on pp.id=psl.parent_profile_id
     join public.students s on s.id=psl.student_id
     where pp.user_id is not null and (
       psl.organization_id<>pp.organization_id
       or psl.organization_id<>s.organization_id
       or (psl.parent_user_id is not null and psl.parent_user_id<>pp.user_id)
     )) as unsafe_parent_links,
    (select count(*) from public.notifications n
     join public.parent_profiles pp on pp.id=n.parent_id
     where n.recipient_user_id is null and pp.user_id is not null
       and n.organization_id=pp.organization_id) as inferable_notifications,
    (select count(*) from public.notifications n
     join public.parent_profiles pp on pp.id=n.parent_id
     where n.organization_id<>pp.organization_id
        or (n.recipient_user_id is not null and pp.user_id is not null
            and n.recipient_user_id<>pp.user_id)) as unsafe_notifications,
    (select count(*) from (
      select organization_id,btrim(idempotency_key)
      from public.leave_requests
      where nullif(btrim(idempotency_key),'') is not null
      group by organization_id,btrim(idempotency_key)
      having count(*)>1
    ) collisions) as leave_normalization_collisions
)
select
  unsafe_parent_links=0
    and unsafe_notifications=0
    and leave_normalization_collisions=0 as safe_to_apply,
  inferable_parent_links,
  unsafe_parent_links,
  inferable_notifications,
  unsafe_notifications,
  leave_normalization_collisions
from counts;
