\set ON_ERROR_STOP on

-- Deliberately corrupt a same-tenant legacy identity as a superuser. The
-- foundation migration must reject it before adding expires_at or changing data.
update public.parent_student_links
set parent_user_id='10000000-0000-4000-8000-000000000004'
where parent_profile_id='13000000-0000-4000-8000-000000000001';
