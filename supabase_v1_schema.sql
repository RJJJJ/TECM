-- TECM v1 Supabase Data Layer
-- Scope: schema + indexes + triggers/functions + RLS + policies + seed data + verification queries

/* =========================================================
   1) EXTENSIONS
   ========================================================= */
create extension if not exists pgcrypto;

/* =========================================================
   2) TABLES
   ========================================================= */

-- 2.1 staff_roles
-- Minimal staff/admin role table for backend management authorization.
create table if not exists public.staff_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  role text not null check (role in ('staff', 'admin')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2.2 parent_profiles
create table if not exists public.parent_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete cascade,
  full_name text not null,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2.3 children
create table if not exists public.children (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references public.parent_profiles(id) on delete cascade,
  child_name text not null,
  age integer,
  school_name text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint children_age_check check (age is null or (age >= 2 and age <= 25))
);

-- 2.4 campuses
create table if not exists public.campuses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2.5 courses
create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text,
  level text,
  age_group text,
  summary text,
  schedule_text text,
  campus_id uuid references public.campuses(id) on delete set null,
  recommended boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2.6 course_tags
create table if not exists public.course_tags (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  tag text not null,
  created_at timestamptz not null default now()
);

-- 2.7 news_items
create table if not exists public.news_items (
  id uuid primary key default gen_random_uuid(),
  category text,
  title text not null,
  summary text,
  content text,
  image_url text,
  is_featured boolean not null default false,
  is_active boolean not null default true,
  published_at timestamptz not null default now(),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2.8 faq_topics
create table if not exists public.faq_topics (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- 2.9 faq_items
create table if not exists public.faq_items (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.faq_topics(id) on delete cascade,
  question text not null,
  answer text not null,
  is_popular boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2.10 bookings
create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.parent_profiles(id) on delete set null,
  child_id uuid references public.children(id) on delete set null,
  parent_name text not null,
  phone text,
  child_name text not null,
  child_age integer,
  school_name text,
  course_id uuid references public.courses(id) on delete set null,
  course_title_snapshot text,
  campus_id uuid references public.campuses(id) on delete set null,
  booking_date date not null,
  start_time time not null,
  end_time time not null,
  note text,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bookings_time_check check (end_time > start_time)
);

-- 2.11 booking_status_logs
create table if not exists public.booking_status_logs (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  old_status text,
  new_status text not null,
  changed_by uuid references auth.users(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);

-- 2.12 follow_up_tasks
-- Internal staff-only follow-up suggestions generated by n8n / automation.
create table if not exists public.follow_up_tasks (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  parent_name text,
  phone text,
  child_name text,
  course_title_snapshot text,
  campus_name text,
  booking_date date,
  start_time time,
  end_time time,
  channel text not null default 'wechat_manual'
    check (channel in ('wechat_manual', 'whatsapp_manual', 'phone_manual', 'in_app')),
  priority text not null default 'medium'
    check (priority in ('low', 'medium', 'high')),
  intent_summary text,
  suggested_message text not null,
  suggested_next_steps text[] not null default '{}',
  internal_note text,
  source text not null default 'automation'
    check (source in ('automation', 'staff', 'manual_seed', 'n8n')),
  status text not null default 'open'
    check (status in ('open', 'done', 'dismissed')),
  completed_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2.13 notifications
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references public.parent_profiles(id) on delete cascade,
  title text not null,
  detail text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

/* =========================================================
   3) INDEXES
   ========================================================= */

-- staff roles
create index if not exists idx_staff_roles_role_active on public.staff_roles(role, is_active);

-- parent/children
create index if not exists idx_parent_profiles_user_id on public.parent_profiles(user_id);
create index if not exists idx_children_parent_id on public.children(parent_id);

-- courses
create index if not exists idx_courses_active_sort on public.courses(is_active, sort_order, created_at desc);
create index if not exists idx_courses_campus on public.courses(campus_id);
create index if not exists idx_course_tags_course_id on public.course_tags(course_id);
create index if not exists idx_course_tags_tag on public.course_tags(tag);

-- news
create index if not exists idx_news_active_published on public.news_items(is_active, published_at desc, sort_order);
create index if not exists idx_news_featured on public.news_items(is_featured, published_at desc);

-- faq
create index if not exists idx_faq_topics_sort on public.faq_topics(sort_order, created_at);
create index if not exists idx_faq_items_topic_active_sort on public.faq_items(topic_id, is_active, sort_order);

-- bookings (critical)
create index if not exists idx_bookings_parent_created on public.bookings(parent_id, created_at desc);
create index if not exists idx_bookings_status_date on public.bookings(status, booking_date, start_time);
create index if not exists idx_bookings_course on public.bookings(course_id);
create index if not exists idx_bookings_campus on public.bookings(campus_id);
create index if not exists idx_booking_logs_booking_created on public.booking_status_logs(booking_id, created_at desc);

-- follow-up tasks
create index if not exists idx_follow_up_tasks_booking_id on public.follow_up_tasks(booking_id);
create index if not exists idx_follow_up_tasks_status_priority_created
  on public.follow_up_tasks(status, priority, created_at desc);
create index if not exists idx_follow_up_tasks_channel_status
  on public.follow_up_tasks(channel, status);
create unique index if not exists idx_follow_up_tasks_one_open_auto_per_booking
  on public.follow_up_tasks(booking_id)
  where status = 'open' and source in ('automation', 'n8n');

-- notifications
create index if not exists idx_notifications_parent_read_created
  on public.notifications(parent_id, is_read, created_at desc);

/* =========================================================
   4) TRIGGERS / FUNCTIONS
   ========================================================= */

-- 4.1 generic updated_at trigger function
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- 4.2 staff/admin helper function
-- SECURITY DEFINER allows role lookup independent of caller table RLS.
create or replace function public.is_staff_or_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.staff_roles sr
    where sr.user_id = auth.uid()
      and sr.is_active = true
      and sr.role in ('staff', 'admin')
  );
$$;

-- 4.3 booking status log trigger
-- If auth.uid() is unavailable (e.g. service role / script), changed_by will be null by design.
create or replace function public.log_booking_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    insert into public.booking_status_logs (
      booking_id,
      old_status,
      new_status,
      changed_by,
      note,
      created_at
    )
    values (
      new.id,
      old.status,
      new.status,
      auth.uid(),
      new.note,
      now()
    );
  end if;

  return new;
end;
$$;

-- 4.4 attach updated_at triggers
create trigger trg_staff_roles_updated_at
before update on public.staff_roles
for each row execute function public.set_updated_at();

create trigger trg_parent_profiles_updated_at
before update on public.parent_profiles
for each row execute function public.set_updated_at();

create trigger trg_children_updated_at
before update on public.children
for each row execute function public.set_updated_at();

create trigger trg_campuses_updated_at
before update on public.campuses
for each row execute function public.set_updated_at();

create trigger trg_courses_updated_at
before update on public.courses
for each row execute function public.set_updated_at();

create trigger trg_news_items_updated_at
before update on public.news_items
for each row execute function public.set_updated_at();

create trigger trg_faq_items_updated_at
before update on public.faq_items
for each row execute function public.set_updated_at();

create trigger trg_bookings_updated_at
before update on public.bookings
for each row execute function public.set_updated_at();

create trigger trg_follow_up_tasks_updated_at
before update on public.follow_up_tasks
for each row execute function public.set_updated_at();

-- 4.5 attach booking status trigger
create trigger trg_bookings_status_log
after update on public.bookings
for each row execute function public.log_booking_status_change();

/* =========================================================
   5) RLS ENABLE
   ========================================================= */

alter table public.staff_roles enable row level security;
alter table public.parent_profiles enable row level security;
alter table public.children enable row level security;
alter table public.campuses enable row level security;
alter table public.courses enable row level security;
alter table public.course_tags enable row level security;
alter table public.news_items enable row level security;
alter table public.faq_topics enable row level security;
alter table public.faq_items enable row level security;
alter table public.bookings enable row level security;
alter table public.booking_status_logs enable row level security;
alter table public.follow_up_tasks enable row level security;
alter table public.notifications enable row level security;

/* =========================================================
   6) POLICIES
   ========================================================= */

-- ---------- 6.1 public read ----------
create policy campuses_public_read_active
on public.campuses
for select
using (is_active = true);

create policy courses_public_read_active
on public.courses
for select
using (is_active = true);

create policy course_tags_public_read
on public.course_tags
for select
using (true);

create policy news_public_read_active
on public.news_items
for select
using (is_active = true);

create policy faq_topics_public_read
on public.faq_topics
for select
using (true);

create policy faq_items_public_read_active
on public.faq_items
for select
using (is_active = true);

-- ---------- 6.2 parent self read/write ----------
create policy parent_profiles_select_own
on public.parent_profiles
for select
using (user_id = auth.uid());

create policy parent_profiles_update_own
on public.parent_profiles
for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy children_select_own
on public.children
for select
using (
  exists (
    select 1 from public.parent_profiles p
    where p.id = children.parent_id
      and p.user_id = auth.uid()
  )
);

create policy children_insert_own
on public.children
for insert
with check (
  exists (
    select 1 from public.parent_profiles p
    where p.id = children.parent_id
      and p.user_id = auth.uid()
  )
);

create policy children_update_own
on public.children
for update
using (
  exists (
    select 1 from public.parent_profiles p
    where p.id = children.parent_id
      and p.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.parent_profiles p
    where p.id = children.parent_id
      and p.user_id = auth.uid()
  )
);

create policy bookings_select_own
on public.bookings
for select
using (
  parent_id in (
    select p.id from public.parent_profiles p where p.user_id = auth.uid()
  )
);

create policy bookings_insert_own_parent
on public.bookings
for insert
with check (
  parent_id in (
    select p.id from public.parent_profiles p where p.user_id = auth.uid()
  )
);

create policy notifications_select_own
on public.notifications
for select
using (
  parent_id in (
    select p.id from public.parent_profiles p where p.user_id = auth.uid()
  )
);

create policy notifications_update_own
on public.notifications
for update
using (
  parent_id in (
    select p.id from public.parent_profiles p where p.user_id = auth.uid()
  )
)
with check (
  parent_id in (
    select p.id from public.parent_profiles p where p.user_id = auth.uid()
  )
);

-- ---------- 6.3 staff/admin full management ----------
create policy staff_roles_self_read
on public.staff_roles
for select
using (user_id = auth.uid() or public.is_staff_or_admin());

create policy staff_roles_admin_manage
on public.staff_roles
for all
using (public.is_staff_or_admin())
with check (public.is_staff_or_admin());

create policy parent_profiles_staff_read
on public.parent_profiles
for select
using (public.is_staff_or_admin());

create policy children_staff_read
on public.children
for select
using (public.is_staff_or_admin());

create policy campuses_staff_manage
on public.campuses
for all
using (public.is_staff_or_admin())
with check (public.is_staff_or_admin());

create policy courses_staff_manage
on public.courses
for all
using (public.is_staff_or_admin())
with check (public.is_staff_or_admin());

create policy course_tags_staff_manage
on public.course_tags
for all
using (public.is_staff_or_admin())
with check (public.is_staff_or_admin());

create policy news_staff_manage
on public.news_items
for all
using (public.is_staff_or_admin())
with check (public.is_staff_or_admin());

create policy faq_topics_staff_manage
on public.faq_topics
for all
using (public.is_staff_or_admin())
with check (public.is_staff_or_admin());

create policy faq_items_staff_manage
on public.faq_items
for all
using (public.is_staff_or_admin())
with check (public.is_staff_or_admin());

create policy bookings_staff_manage
on public.bookings
for all
using (public.is_staff_or_admin())
with check (public.is_staff_or_admin());

create policy booking_logs_staff_manage
on public.booking_status_logs
for all
using (public.is_staff_or_admin())
with check (public.is_staff_or_admin());

create policy follow_up_tasks_staff_manage
on public.follow_up_tasks
for all
using (public.is_staff_or_admin())
with check (public.is_staff_or_admin());

create policy notifications_staff_manage
on public.notifications
for all
using (public.is_staff_or_admin())
with check (public.is_staff_or_admin());

/* =========================================================
   7) SEED DATA
   ========================================================= */

-- NOTE:
-- 1) auth.users cannot be freely inserted here in normal Supabase projects.
-- 2) We create a parent profile with user_id = null for demo linkage.
-- 3) After you have a real auth user id, run the update block near the end.

-- 7.1 campuses
insert into public.campuses (id, name, address, is_active)
values
  ('10000000-0000-0000-0000-000000000001', '澳門半島校區', '澳門半島新口岸宋玉生廣場教學中心 3F', true),
  ('10000000-0000-0000-0000-000000000002', '氹仔校區', '氹仔南京街社區教學大樓 2F', true),
  ('10000000-0000-0000-0000-000000000003', '路氹城校區', '路氹城教育路創科學習中心 5F', true)
on conflict (id) do update set
  name = excluded.name,
  address = excluded.address,
  is_active = excluded.is_active,
  updated_at = now();

-- 7.2 courses
insert into public.courses (
  id, title, category, level, age_group, summary, schedule_text,
  campus_id, recommended, is_active, sort_order
)
values
  (
    '20000000-0000-0000-0000-000000000001',
    'Python 入門：計算思維與程式基礎',
    '程式設計',
    '入門',
    '9-12 歲',
    '以專題式任務建立變數、條件與迴圈概念，培養可遷移的邏輯拆解能力。課程強調「看得懂、改得動、說得清」的學習成果。',
    '每週六 10:00-11:30（12 週）',
    '10000000-0000-0000-0000-000000000001',
    true,
    true,
    1
  ),
  (
    '20000000-0000-0000-0000-000000000002',
    'Python 核心：資料結構與問題解決',
    '程式設計',
    '核心',
    '11-15 歲',
    '延伸至函式、列表與字典，透過真實情境題建立演算法思維與除錯習慣，為進階專題與競賽打底。',
    '每週日 14:00-16:00（10 週）',
    '10000000-0000-0000-0000-000000000002',
    true,
    true,
    2
  ),
  (
    '20000000-0000-0000-0000-000000000003',
    'Python 進階：專題開發與資料應用',
    '程式設計',
    '進階',
    '13-17 歲',
    '採用小組專題模式，整合 API、資料處理與展示流程，訓練需求分析、版本管理與成果發表能力。',
    '每週六 14:30-16:30（10 週）',
    '10000000-0000-0000-0000-000000000003',
    false,
    true,
    3
  ),
  (
    '20000000-0000-0000-0000-000000000004',
    'Scratch 互動創作：故事、遊戲與邏輯',
    '創意程式',
    '入門-核心',
    '7-11 歲',
    '以互動故事與遊戲製作培養順序、事件與條件邏輯，兼顧表達、合作與作品展示，適合零基礎起步。',
    '每週三 16:30-18:00（8 週）',
    '10000000-0000-0000-0000-000000000001',
    true,
    true,
    4
  ),
  (
    '20000000-0000-0000-0000-000000000005',
    'C++ 基礎：結構化程式與演算法啟蒙',
    '競賽基礎',
    '基礎',
    '12-16 歲',
    '建立型別、流程控制與函式拆解能力，導入基礎資料結構觀念，適合作為資訊競賽與進階 CS 的前置課程。',
    '每週五 19:00-21:00（12 週）',
    '10000000-0000-0000-0000-000000000002',
    false,
    true,
    5
  )
on conflict (id) do update set
  title = excluded.title,
  category = excluded.category,
  level = excluded.level,
  age_group = excluded.age_group,
  summary = excluded.summary,
  schedule_text = excluded.schedule_text,
  campus_id = excluded.campus_id,
  recommended = excluded.recommended,
  is_active = excluded.is_active,
  sort_order = excluded.sort_order,
  updated_at = now();

-- 7.3 course_tags
insert into public.course_tags (id, course_id, tag)
values
  ('21000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '邏輯思維'),
  ('21000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '專題任務'),
  ('21000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', '零基礎友善'),

  ('21000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000002', '資料結構'),
  ('21000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000002', '除錯訓練'),
  ('21000000-0000-0000-0000-000000000006', '20000000-0000-0000-0000-000000000002', '問題解決'),

  ('21000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000003', 'API 應用'),
  ('21000000-0000-0000-0000-000000000008', '20000000-0000-0000-0000-000000000003', '專題開發'),
  ('21000000-0000-0000-0000-000000000009', '20000000-0000-0000-0000-000000000003', '成果發表'),

  ('21000000-0000-0000-0000-000000000010', '20000000-0000-0000-0000-000000000004', '互動設計'),
  ('21000000-0000-0000-0000-000000000011', '20000000-0000-0000-0000-000000000004', '創意敘事'),
  ('21000000-0000-0000-0000-000000000012', '20000000-0000-0000-0000-000000000004', '運算思維'),

  ('21000000-0000-0000-0000-000000000013', '20000000-0000-0000-0000-000000000005', '語法基礎'),
  ('21000000-0000-0000-0000-000000000014', '20000000-0000-0000-0000-000000000005', '演算法入門'),
  ('21000000-0000-0000-0000-000000000015', '20000000-0000-0000-0000-000000000005', '競賽準備')
on conflict (id) do nothing;

-- 7.4 news_items
insert into public.news_items (
  id, category, title, summary, content, image_url,
  is_featured, is_active, published_at, sort_order
)
values
  (
    '30000000-0000-0000-0000-000000000001',
    '活動',
    'TECM 開放日：程式學習體驗週正式開放報名',
    '為 7-15 歲學生提供分齡試學與家長諮詢時段。',
    '本次開放日採小班導覽，包含課程體驗、學習路徑說明與個別 Q&A。建議家長預先提交孩子學習背景，以便顧問提供更精準建議。',
    'https://images.example.com/tecm/open-day.jpg',
    true,
    true,
    now() - interval '10 day',
    1
  ),
  (
    '30000000-0000-0000-0000-000000000002',
    '家長講座',
    '家長講座：如何陪伴孩子建立長期程式學習習慣',
    '聚焦學習節奏、挫折管理與家庭支持策略。',
    '講座由教學總監主講，將分享不同年齡層常見學習盲點與可執行的家庭支持方法，並提供課後追蹤建議。',
    'https://images.example.com/tecm/parent-talk.jpg',
    false,
    true,
    now() - interval '7 day',
    2
  ),
  (
    '30000000-0000-0000-0000-000000000003',
    '新課程',
    'Python 核心班新增平日夜間時段',
    '回應家長需求，新增平日夜間班以提升排課彈性。',
    '新時段將延續既有核心課程架構，重點放在資料結構、實作演練與除錯流程。適合已完成入門班或具基礎經驗學生。',
    'https://images.example.com/tecm/python-core-evening.jpg',
    false,
    true,
    now() - interval '4 day',
    3
  ),
  (
    '30000000-0000-0000-0000-000000000004',
    '學生成果',
    '學生專題成果展：從想法到可互動作品',
    '展示跨班級專題，包含互動遊戲、資料視覺化與小型工具。',
    '成果展重視學習過程與反思，學生將於現場說明需求拆解、技術選擇與版本迭代，展現完整問題解決能力。',
    'https://images.example.com/tecm/student-showcase.jpg',
    true,
    true,
    now() - interval '1 day',
    4
  )
on conflict (id) do update set
  category = excluded.category,
  title = excluded.title,
  summary = excluded.summary,
  content = excluded.content,
  image_url = excluded.image_url,
  is_featured = excluded.is_featured,
  is_active = excluded.is_active,
  published_at = excluded.published_at,
  sort_order = excluded.sort_order,
  updated_at = now();

-- 7.5 faq_topics
insert into public.faq_topics (id, name, sort_order)
values
  ('40000000-0000-0000-0000-000000000001', '選課策略', 1),
  ('40000000-0000-0000-0000-000000000002', '課程內容', 2),
  ('40000000-0000-0000-0000-000000000003', '預約流程', 3)
on conflict (id) do update set
  name = excluded.name,
  sort_order = excluded.sort_order;

-- 7.6 faq_items
insert into public.faq_items (
  id, topic_id, question, answer, is_popular, is_active, sort_order
)
values
  (
    '41000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000001',
    '孩子幾歲開始接觸程式學習最合適？',
    '一般建議從 7 歲起可透過 Scratch 建立運算思維；9 歲以上可逐步銜接 Python 入門。實際仍以孩子的專注度、表達能力與學習動機做評估。',
    true,
    true,
    1
  ),
  (
    '41000000-0000-0000-0000-000000000002',
    '40000000-0000-0000-0000-000000000001',
    '零基礎應該先選哪一門課？',
    '若孩子偏好視覺與創作，可先從 Scratch 互動創作開始；若已具備一定閱讀與邏輯能力，可直接進入 Python 入門班。顧問可依試學觀察提供分班建議。',
    true,
    true,
    2
  ),
  (
    '41000000-0000-0000-0000-000000000003',
    '40000000-0000-0000-0000-000000000002',
    'Python、Scratch、C++ 的學習差異是什麼？',
    'Scratch 重在邏輯啟蒙與創意表達；Python 著重通用程式能力與實作應用；C++ 則更強調語法精確度與演算法訓練，常作為競賽與進階 CS 的基礎。',
    true,
    true,
    1
  ),
  (
    '41000000-0000-0000-0000-000000000004',
    '40000000-0000-0000-0000-000000000003',
    '如何預約體驗課程？',
    '登入家長帳號後，於預約頁選擇校區、課程與可配合時段送出即可。送出後可在家長中心查看狀態，中心會於工作時間內確認。',
    true,
    true,
    1
  ),
  (
    '41000000-0000-0000-0000-000000000005',
    '40000000-0000-0000-0000-000000000003',
    '正式分班前是否會先做學習評估？',
    '會。TECM 採用短時任務與口頭回饋進行初步診斷，涵蓋邏輯、表達與學習節奏，避免孩子進入不匹配的班級。',
    false,
    true,
    2
  ),
  (
    '41000000-0000-0000-0000-000000000006',
    '40000000-0000-0000-0000-000000000002',
    '完成入門後，如何銜接進階學習？',
    '建議依「入門 → 核心 → 專題/進階」節奏銜接，每階段搭配作品與能力指標檢核。顧問會根據學習紀錄建議下一門最合適課程。',
    false,
    true,
    2
  )
on conflict (id) do update set
  topic_id = excluded.topic_id,
  question = excluded.question,
  answer = excluded.answer,
  is_popular = excluded.is_popular,
  is_active = excluded.is_active,
  sort_order = excluded.sort_order,
  updated_at = now();

-- 7.7 test parent / child / bookings / notifications
insert into public.parent_profiles (id, user_id, full_name, phone)
values
  (
    '50000000-0000-0000-0000-000000000001',
    null,
    '陳家怡',
    '+853 6123 4567'
  )
on conflict (id) do update set
  full_name = excluded.full_name,
  phone = excluded.phone,
  updated_at = now();

insert into public.children (id, parent_id, child_name, age, school_name, notes)
values
  (
    '51000000-0000-0000-0000-000000000001',
    '50000000-0000-0000-0000-000000000001',
    '陳朗希',
    10,
    '聖若瑟教區中學（小學部）',
    '對遊戲設計有高度興趣，喜歡以專題方式學習。'
  )
on conflict (id) do update set
  child_name = excluded.child_name,
  age = excluded.age,
  school_name = excluded.school_name,
  notes = excluded.notes,
  updated_at = now();

insert into public.bookings (
  id, parent_id, child_id,
  parent_name, phone, child_name, child_age, school_name,
  course_id, course_title_snapshot, campus_id,
  booking_date, start_time, end_time, note, status
)
values
  (
    '52000000-0000-0000-0000-000000000001',
    '50000000-0000-0000-0000-000000000001',
    '51000000-0000-0000-0000-000000000001',
    '陳家怡',
    '+853 6123 4567',
    '陳朗希',
    10,
    '聖若瑟教區中學（小學部）',
    '20000000-0000-0000-0000-000000000001',
    'Python 入門：計算思維與程式基礎',
    '10000000-0000-0000-0000-000000000001',
    current_date + 3,
    '10:00',
    '11:30',
    '希望安排英文輔助說明。',
    'pending'
  ),
  (
    '52000000-0000-0000-0000-000000000002',
    '50000000-0000-0000-0000-000000000001',
    '51000000-0000-0000-0000-000000000001',
    '陳家怡',
    '+853 6123 4567',
    '陳朗希',
    10,
    '聖若瑟教區中學（小學部）',
    '20000000-0000-0000-0000-000000000004',
    'Scratch 互動創作：故事、遊戲與邏輯',
    '10000000-0000-0000-0000-000000000001',
    current_date + 10,
    '16:30',
    '18:00',
    '孩子偏好互動遊戲主題。',
    'confirmed'
  ),
  (
    '52000000-0000-0000-0000-000000000003',
    '50000000-0000-0000-0000-000000000001',
    '51000000-0000-0000-0000-000000000001',
    '陳家怡',
    '+853 6123 4567',
    '陳朗希',
    10,
    '聖若瑟教區中學（小學部）',
    '20000000-0000-0000-0000-000000000002',
    'Python 核心：資料結構與問題解決',
    '10000000-0000-0000-0000-000000000002',
    current_date - 20,
    '14:00',
    '16:00',
    '已完成體驗，評估可銜接核心班。',
    'completed'
  )
on conflict (id) do update set
  parent_id = excluded.parent_id,
  child_id = excluded.child_id,
  parent_name = excluded.parent_name,
  phone = excluded.phone,
  child_name = excluded.child_name,
  child_age = excluded.child_age,
  school_name = excluded.school_name,
  course_id = excluded.course_id,
  course_title_snapshot = excluded.course_title_snapshot,
  campus_id = excluded.campus_id,
  booking_date = excluded.booking_date,
  start_time = excluded.start_time,
  end_time = excluded.end_time,
  note = excluded.note,
  status = excluded.status,
  updated_at = now();

insert into public.notifications (id, parent_id, title, detail, is_read)
values
  (
    '53000000-0000-0000-0000-000000000001',
    '50000000-0000-0000-0000-000000000001',
    '預約已受理',
    '您提交的 Python 入門體驗預約已建立，中心將於一個工作日內完成確認。',
    false
  ),
  (
    '53000000-0000-0000-0000-000000000002',
    '50000000-0000-0000-0000-000000000001',
    '體驗課後建議已更新',
    '顧問已提供學習銜接建議，建議先修 Python 核心班再進入專題課程。',
    false
  )
on conflict (id) do update set
  title = excluded.title,
  detail = excluded.detail,
  is_read = excluded.is_read;

-- 7.8 demo internal follow-up tasks for Admin Web / automation preview only.
insert into public.follow_up_tasks (
  id,
  booking_id,
  parent_name,
  phone,
  child_name,
  course_title_snapshot,
  campus_name,
  booking_date,
  start_time,
  end_time,
  channel,
  priority,
  intent_summary,
  suggested_message,
  suggested_next_steps,
  internal_note,
  source,
  status
)
select
  '54000000-0000-0000-0000-000000000001',
  b.id,
  b.parent_name,
  b.phone,
  b.child_name,
  b.course_title_snapshot,
  c.name,
  b.booking_date,
  b.start_time,
  b.end_time,
  'wechat_manual',
  'high',
  'å®¶é·å·²æäº¤ Python å
¥éé«é©èª²é ç´ï¼å»ºè­°åªå
ç¢ºèªå­©å­æ¯å¦æ Scratch æç·¨ç¨åºç¤ã',
  '您好，這裡是 TECM 澳門教育中心。已收到您為孩子預約 Python 入門體驗課的資料。想先跟您確認孩子是否曾學習 Scratch 或其他編程課程？我們可按程度安排最合適的體驗內容。',
¥éé«é©èª²çè³æãæ³å
è·æ¨ç¢ºèªå­©å­æ¯å¦æ¾å­¸ç¿ Scratch æå
¶ä»ç·¨ç¨èª²ç¨ï¼æåå¯æç¨åº¦å®ææåé©çé«é©å
§å®¹ã',
  array['確認孩子過往編程經驗', '確認體驗課日期及時段', '如家長回覆積極，可安排程度評估'],
  'Demo seed：內部 staff 跟進建議，不會自動發送給家長。',
§é¨ staff è·é²å»ºè­°ï¼ä¸æèªåç¼éçµ¦å®¶é·ã',
  'manual_seed',
  'open'
from public.bookings b
left join public.campuses c on c.id = b.campus_id
where b.id = '52000000-0000-0000-0000-000000000001'
on conflict (id) do update set
  parent_name = excluded.parent_name,
  phone = excluded.phone,
  child_name = excluded.child_name,
  course_title_snapshot = excluded.course_title_snapshot,
  campus_name = excluded.campus_name,
  booking_date = excluded.booking_date,
  start_time = excluded.start_time,
  end_time = excluded.end_time,
  priority = excluded.priority,
  intent_summary = excluded.intent_summary,
  suggested_message = excluded.suggested_message,
  suggested_next_steps = excluded.suggested_next_steps,
  internal_note = excluded.internal_note,
  updated_at = now();

-- 7.9 optional staff role sample
-- Replace the placeholder UUID with a real auth.users.id before execution.
-- insert into public.staff_roles (user_id, role, is_active)
-- values ('<REAL_AUTH_USER_UUID>', 'admin', true)
-- on conflict (user_id) do update set role = excluded.role, is_active = excluded.is_active, updated_at = now();

-- 7.10 bind real parent auth user id (run after parent signs up)
-- Replace the placeholder UUID with the actual auth.users.id.
-- update public.parent_profiles
-- set user_id = '<REAL_PARENT_AUTH_USER_UUID>', updated_at = now()
-- where id = '50000000-0000-0000-0000-000000000001';

/* =========================================================
   8) TEST QUERIES SQL
   ========================================================= */

-- 8.1 verify tables exist
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'staff_roles', 'parent_profiles', 'children', 'campuses', 'courses', 'course_tags',
    'news_items', 'faq_topics', 'faq_items', 'bookings', 'booking_status_logs', 'follow_up_tasks', 'notifications'
  )
order by table_name;

-- 8.2 verify public content
select id, name from public.campuses where is_active = true order by name;
select id, title, category, level from public.courses where is_active = true order by sort_order;
select id, title, category from public.news_items where is_active = true order by published_at desc;
select t.name as topic, i.question
from public.faq_items i
join public.faq_topics t on t.id = i.topic_id
where i.is_active = true
order by t.sort_order, i.sort_order;

-- 8.3 verify booking status trigger
-- Run once to change status and then inspect booking_status_logs.
-- update public.bookings
-- set status = 'cancelled', note = '家長行程調整'
-- where id = '52000000-0000-0000-0000-000000000001';
-- select booking_id, old_status, new_status, changed_by, created_at
-- from public.booking_status_logs
-- where booking_id = '52000000-0000-0000-0000-000000000001'
-- order by created_at desc;

-- 8.4 verify follow-up automation tasks
select id, booking_id, priority, channel, status, created_at
from public.follow_up_tasks
order by created_at desc
limit 20;

select
  b.id as booking_id,
  b.parent_name,
  b.child_name,
  b.status as booking_status,
  f.priority,
  f.channel,
  f.status as follow_up_status,
  f.created_at as follow_up_created_at
from public.bookings b
join public.follow_up_tasks f on f.booking_id = b.id
order by f.created_at desc;

select b.id, b.parent_name, b.child_name, b.created_at
from public.bookings b
where b.status = 'pending'
  and not exists (
    select 1
    from public.follow_up_tasks f
    where f.booking_id = b.id
      and f.status = 'open'
  )
order by b.created_at desc;

-- 8.5 verify RLS is enabled
select schemaname, tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in (
    'staff_roles', 'parent_profiles', 'children', 'campuses', 'courses', 'course_tags',
    'news_items', 'faq_topics', 'faq_items', 'bookings', 'booking_status_logs', 'follow_up_tasks', 'notifications'
  )
order by tablename;

/* =========================================================
   9) EXAM COHORT ATTENDANCE & MAKEUP TRACKING
   ========================================================= */

-- Teachers are intentionally kept out of staff_roles.
-- staff_roles remains the staff/admin gate for admin web / boss operations.

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  child_id uuid unique references public.children(id) on delete set null,
  display_name text not null,
  school_name text,
  birth_date date,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.parent_student_links (
  id uuid primary key default gen_random_uuid(),
  parent_profile_id uuid not null references public.parent_profiles(id) on delete cascade,
  parent_user_id uuid references auth.users(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  relationship text not null default 'parent',
  is_primary boolean not null default true,
  created_at timestamptz not null default now(),
  unique(parent_profile_id, student_id)
);

create table if not exists public.teacher_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  display_name text not null,
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.exam_cohorts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  subject text not null check (subject in ('Python', 'Scratch', 'C++')),
  level text not null,
  exam_date date not null,
  weekday_pattern text not null check (weekday_pattern in ('saturday', 'sunday')),
  course_id uuid references public.courses(id) on delete set null,
  campus_id uuid references public.campuses(id) on delete set null,
  lead_teacher_id uuid references public.teacher_profiles(id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'active', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cohort_students (
  id uuid primary key default gen_random_uuid(),
  cohort_id uuid not null references public.exam_cohorts(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'withdrawn', 'completed')),
  is_active_membership boolean not null default false,
  joined_at date not null default current_date,
  left_at date,
  created_at timestamptz not null default now(),
  unique(cohort_id, student_id)
);

create table if not exists public.lesson_plans (
  id uuid primary key default gen_random_uuid(),
  cohort_id uuid not null references public.exam_cohorts(id) on delete cascade,
  sequence_no integer not null check (sequence_no between 1 and 12),
  title text not null,
  teaching_content text,
  knowledge_points jsonb not null default '[]'::jsonb,
  makeup_guidance text,
  planned_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(cohort_id, sequence_no)
);

create table if not exists public.lesson_sessions (
  id uuid primary key default gen_random_uuid(),
  cohort_id uuid not null references public.exam_cohorts(id) on delete cascade,
  lesson_plan_id uuid not null references public.lesson_plans(id) on delete restrict,
  teacher_id uuid not null references public.teacher_profiles(id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lesson_sessions_time_check check (ends_at > starts_at)
);

create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.lesson_sessions(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  status text not null check (status in ('present', 'excused', 'absent', 'makeup_completed')),
  recorded_by uuid references auth.users(id) on delete set null,
  recorded_at timestamptz not null default now(),
  internal_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(session_id, student_id)
);

create table if not exists public.makeup_tasks (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  cohort_id uuid not null references public.exam_cohorts(id) on delete cascade,
  lesson_plan_id uuid not null references public.lesson_plans(id) on delete restrict,
  original_session_id uuid not null references public.lesson_sessions(id) on delete cascade,
  attendance_record_id uuid not null unique references public.attendance_records(id) on delete cascade,
  missed_status text not null check (missed_status in ('absent', 'excused')),
  status text not null default 'pending' check (status in ('pending', 'recommended', 'scheduled', 'completed', 'waived', 'cancelled')),
  priority text not null default 'normal' check (priority in ('normal', 'high', 'urgent')),
  parent_visible_summary text,
  internal_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.makeup_sessions (
  id uuid primary key default gen_random_uuid(),
  makeup_task_id uuid not null references public.makeup_tasks(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  teacher_id uuid references public.teacher_profiles(id) on delete set null,
  scheduled_at timestamptz not null,
  completed_at timestamptz,
  status text not null default 'scheduled' check (status in ('scheduled', 'completed', 'cancelled', 'no_show')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.makeup_recommendations (
  id uuid primary key default gen_random_uuid(),
  makeup_task_id uuid not null references public.makeup_tasks(id) on delete cascade,
  recommended_session_id uuid references public.lesson_sessions(id) on delete set null,
  recommendation_text text,
  score numeric,
  status text not null default 'open' check (status in ('open', 'accepted', 'rejected', 'expired')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_students_child on public.students(child_id);
create index if not exists idx_parent_student_links_parent on public.parent_student_links(parent_profile_id);
create index if not exists idx_parent_student_links_user on public.parent_student_links(parent_user_id);
create index if not exists idx_teacher_profiles_user on public.teacher_profiles(user_id);
create index if not exists idx_exam_cohorts_status_exam on public.exam_cohorts(status, exam_date);
create index if not exists idx_exam_cohorts_teacher on public.exam_cohorts(lead_teacher_id);
create unique index if not exists unique_active_exam_membership
  on public.cohort_students(student_id)
  where is_active_membership = true;
create index if not exists idx_lesson_plans_cohort_sequence on public.lesson_plans(cohort_id, sequence_no);
create index if not exists idx_lesson_sessions_teacher_starts on public.lesson_sessions(teacher_id, starts_at);
create index if not exists idx_attendance_session on public.attendance_records(session_id);
create index if not exists idx_makeup_tasks_status_priority on public.makeup_tasks(status, priority, created_at);
create index if not exists idx_makeup_sessions_task on public.makeup_sessions(makeup_task_id);

create trigger trg_students_updated_at
before update on public.students
for each row execute function public.set_updated_at();

create trigger trg_teacher_profiles_updated_at
before update on public.teacher_profiles
for each row execute function public.set_updated_at();

create trigger trg_exam_cohorts_updated_at
before update on public.exam_cohorts
for each row execute function public.set_updated_at();

create trigger trg_lesson_plans_updated_at
before update on public.lesson_plans
for each row execute function public.set_updated_at();

create trigger trg_lesson_sessions_updated_at
before update on public.lesson_sessions
for each row execute function public.set_updated_at();

create trigger trg_attendance_records_updated_at
before update on public.attendance_records
for each row execute function public.set_updated_at();

create trigger trg_makeup_tasks_updated_at
before update on public.makeup_tasks
for each row execute function public.set_updated_at();

create trigger trg_makeup_sessions_updated_at
before update on public.makeup_sessions
for each row execute function public.set_updated_at();

create or replace function public.sync_cohort_student_active_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cohort_status text;
begin
  select status into cohort_status from public.exam_cohorts where id = new.cohort_id;
  new.is_active_membership = (new.status = 'active' and cohort_status = 'active');
  return new;
end;
$$;

drop trigger if exists trg_cohort_students_active_membership on public.cohort_students;
create trigger trg_cohort_students_active_membership
before insert or update on public.cohort_students
for each row execute function public.sync_cohort_student_active_membership();

create or replace function public.refresh_cohort_active_memberships()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.cohort_students cs
  set is_active_membership = (cs.status = 'active' and new.status = 'active')
  where cs.cohort_id = new.id;
  return new;
end;
$$;

drop trigger if exists trg_exam_cohorts_refresh_memberships on public.exam_cohorts;
create trigger trg_exam_cohorts_refresh_memberships
after update of status on public.exam_cohorts
for each row execute function public.refresh_cohort_active_memberships();

create or replace function public.is_active_teacher()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.teacher_profiles tp
    where tp.user_id = auth.uid() and tp.is_active = true
  );
$$;

create or replace function public.is_teacher_for_cohort(target_cohort_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.exam_cohorts ec
    join public.teacher_profiles tp on tp.id = ec.lead_teacher_id
    where ec.id = target_cohort_id
      and tp.user_id = auth.uid()
      and tp.is_active = true
  );
$$;

create or replace function public.is_teacher_for_session(target_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.lesson_sessions ls
    join public.teacher_profiles tp on tp.id = ls.teacher_id
    where ls.id = target_session_id
      and tp.user_id = auth.uid()
      and tp.is_active = true
  );
$$;

create or replace function public.is_parent_of_student(target_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.parent_student_links psl
    where psl.student_id = target_student_id
      and psl.parent_user_id = auth.uid()
  );
$$;

create or replace function public.ensure_makeup_task_for_attendance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  session_row public.lesson_sessions%rowtype;
begin
  if new.status in ('absent', 'excused') then
    select * into session_row from public.lesson_sessions where id = new.session_id;

    insert into public.makeup_tasks (
      student_id,
      cohort_id,
      lesson_plan_id,
      original_session_id,
      attendance_record_id,
      missed_status,
      status,
      parent_visible_summary
    )
    values (
      new.student_id,
      session_row.cohort_id,
      session_row.lesson_plan_id,
      new.session_id,
      new.id,
      new.status,
      'pending',
      '待補課 1 節'
    )
    on conflict (attendance_record_id) do update set
      missed_status = excluded.missed_status,
      status = case
        when public.makeup_tasks.status in ('completed', 'waived', 'cancelled') then public.makeup_tasks.status
        else 'pending'
      end,
      updated_at = now();
  elsif new.status = 'makeup_completed' then
    update public.makeup_tasks
    set status = 'completed', updated_at = now()
    where attendance_record_id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_attendance_makeup_task on public.attendance_records;
create trigger trg_attendance_makeup_task
after insert or update of status on public.attendance_records
for each row execute function public.ensure_makeup_task_for_attendance();

alter table public.students enable row level security;
alter table public.parent_student_links enable row level security;
alter table public.teacher_profiles enable row level security;
alter table public.exam_cohorts enable row level security;
alter table public.cohort_students enable row level security;
alter table public.lesson_plans enable row level security;
alter table public.lesson_sessions enable row level security;
alter table public.attendance_records enable row level security;
alter table public.makeup_tasks enable row level security;
alter table public.makeup_sessions enable row level security;
alter table public.makeup_recommendations enable row level security;

create policy students_parent_summary_read
on public.students for select
using (public.is_parent_of_student(id) or public.is_staff_or_admin() or exists (
  select 1 from public.cohort_students cs
  where cs.student_id = students.id and public.is_teacher_for_cohort(cs.cohort_id)
));

create policy students_staff_manage
on public.students for all
using (public.is_staff_or_admin())
with check (public.is_staff_or_admin());

create policy parent_student_links_parent_read
on public.parent_student_links for select
using (parent_user_id = auth.uid() or public.is_staff_or_admin());

create policy parent_student_links_staff_manage
on public.parent_student_links for all
using (public.is_staff_or_admin())
with check (public.is_staff_or_admin());

create policy teacher_profiles_self_read
on public.teacher_profiles for select
using (user_id = auth.uid() or public.is_staff_or_admin());

create policy teacher_profiles_staff_manage
on public.teacher_profiles for all
using (public.is_staff_or_admin())
with check (public.is_staff_or_admin());

create policy exam_cohorts_teacher_read
on public.exam_cohorts for select
using (public.is_teacher_for_cohort(id) or public.is_staff_or_admin());

create policy exam_cohorts_staff_manage
on public.exam_cohorts for all
using (public.is_staff_or_admin())
with check (public.is_staff_or_admin());

create policy cohort_students_teacher_read
on public.cohort_students for select
using (public.is_teacher_for_cohort(cohort_id) or public.is_staff_or_admin());

create policy cohort_students_staff_manage
on public.cohort_students for all
using (public.is_staff_or_admin())
with check (public.is_staff_or_admin());

create policy lesson_plans_teacher_read
on public.lesson_plans for select
using (public.is_teacher_for_cohort(cohort_id) or public.is_staff_or_admin());

create policy lesson_plans_staff_manage
on public.lesson_plans for all
using (public.is_staff_or_admin())
with check (public.is_staff_or_admin());

create policy lesson_sessions_teacher_read
on public.lesson_sessions for select
using (public.is_teacher_for_session(id) or public.is_staff_or_admin());

create policy lesson_sessions_staff_manage
on public.lesson_sessions for all
using (public.is_staff_or_admin())
with check (public.is_staff_or_admin());

create policy attendance_teacher_write_own_session
on public.attendance_records for all
using (public.is_teacher_for_session(session_id) or public.is_staff_or_admin())
with check (public.is_teacher_for_session(session_id) or public.is_staff_or_admin());

create policy makeup_tasks_teacher_read
on public.makeup_tasks for select
using (public.is_teacher_for_cohort(cohort_id) or public.is_staff_or_admin());

create policy makeup_tasks_staff_manage
on public.makeup_tasks for all
using (public.is_staff_or_admin())
with check (public.is_staff_or_admin());

create policy makeup_sessions_teacher_read
on public.makeup_sessions for select
using (
  public.is_staff_or_admin()
  or exists (
    select 1 from public.makeup_tasks mt
    where mt.id = makeup_sessions.makeup_task_id
      and public.is_teacher_for_cohort(mt.cohort_id)
  )
);

create policy makeup_sessions_staff_manage
on public.makeup_sessions for all
using (public.is_staff_or_admin())
with check (public.is_staff_or_admin());

create policy makeup_recommendations_staff_manage
on public.makeup_recommendations for all
using (public.is_staff_or_admin())
with check (public.is_staff_or_admin());

create or replace view public.parent_exam_attendance_summary
with (security_invoker = true)
as
select
  psl.parent_user_id,
  s.id as student_id,
  s.display_name as student_name,
  ec.id as cohort_id,
  ec.name as cohort_name,
  count(ar.id) filter (where ar.status in ('present', 'makeup_completed')) as completed_lessons,
  count(ar.id) filter (where ar.status in ('present', 'excused', 'absent', 'makeup_completed')) as recorded_lessons,
  count(mt.id) filter (where mt.status in ('pending', 'recommended')) as pending_makeup_count,
  count(mt.id) filter (where mt.status = 'scheduled') as scheduled_makeup_count,
  case
    when count(mt.id) filter (where mt.status in ('pending', 'recommended')) = 0 then '暫無待補課'
    else '待補課 ' || count(mt.id) filter (where mt.status in ('pending', 'recommended')) || ' 節'
  end as display_text
from public.parent_student_links psl
join public.students s on s.id = psl.student_id
join public.cohort_students cs on cs.student_id = s.id and cs.status = 'active'
join public.exam_cohorts ec on ec.id = cs.cohort_id
left join public.lesson_sessions ls on ls.cohort_id = ec.id
left join public.attendance_records ar on ar.session_id = ls.id and ar.student_id = s.id
left join public.makeup_tasks mt on mt.student_id = s.id and mt.cohort_id = ec.id
group by psl.parent_user_id, s.id, s.display_name, ec.id, ec.name;

create or replace function public.get_parent_attendance_summary()
returns table (
  student_id uuid,
  student_name text,
  cohort_id uuid,
  cohort_name text,
  completed_lessons bigint,
  recorded_lessons bigint,
  pending_makeup_count bigint,
  scheduled_makeup_count bigint,
  display_text text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    student_id,
    student_name,
    cohort_id,
    cohort_name,
    completed_lessons,
    recorded_lessons,
    pending_makeup_count,
    scheduled_makeup_count,
    display_text
  from public.parent_exam_attendance_summary
  where parent_user_id = auth.uid();
$$;

create or replace function public.get_teacher_today_sessions()
returns table (
  session_id uuid,
  cohort_id uuid,
  cohort_name text,
  subject text,
  level text,
  lesson_plan_id uuid,
  sequence_no integer,
  lesson_title text,
  teaching_content text,
  starts_at timestamptz,
  ends_at timestamptz,
  attendance_count bigint,
  student_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    ls.id,
    ec.id,
    ec.name,
    ec.subject,
    ec.level,
    lp.id,
    lp.sequence_no,
    lp.title,
    lp.teaching_content,
    ls.starts_at,
    ls.ends_at,
    count(distinct ar.id),
    count(distinct cs.student_id)
  from public.lesson_sessions ls
  join public.teacher_profiles tp on tp.id = ls.teacher_id
  join public.exam_cohorts ec on ec.id = ls.cohort_id
  join public.lesson_plans lp on lp.id = ls.lesson_plan_id
  left join public.cohort_students cs on cs.cohort_id = ec.id and cs.status = 'active'
  left join public.attendance_records ar on ar.session_id = ls.id
  where tp.user_id = auth.uid()
    and tp.is_active = true
    and ls.starts_at::date = current_date
  group by ls.id, ec.id, ec.name, ec.subject, ec.level, lp.id, lp.sequence_no, lp.title, lp.teaching_content, ls.starts_at, ls.ends_at
  order by ls.starts_at;
$$;

create or replace function public.submit_attendance(target_session_id uuid, records jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
begin
  if not (public.is_teacher_for_session(target_session_id) or public.is_staff_or_admin()) then
    raise exception 'not allowed to submit attendance for this session';
  end if;

  for item in select * from jsonb_array_elements(records)
  loop
    insert into public.attendance_records (
      session_id,
      student_id,
      status,
      recorded_by,
      recorded_at,
      internal_note
    )
    values (
      target_session_id,
      (item->>'student_id')::uuid,
      item->>'status',
      auth.uid(),
      now(),
      nullif(item->>'internal_note', '')
    )
    on conflict (session_id, student_id) do update set
      status = excluded.status,
      recorded_by = excluded.recorded_by,
      recorded_at = excluded.recorded_at,
      internal_note = excluded.internal_note,
      updated_at = now();
  end loop;
end;
$$;

create or replace function public.get_lesson_session_students(target_session_id uuid)
returns table (
  student_id uuid,
  display_name text,
  school_name text,
  attendance_status text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.id,
    s.display_name,
    s.school_name,
    ar.status
  from public.lesson_sessions ls
  join public.cohort_students cs on cs.cohort_id = ls.cohort_id and cs.status = 'active'
  join public.students s on s.id = cs.student_id
  left join public.attendance_records ar on ar.session_id = ls.id and ar.student_id = s.id
  where ls.id = target_session_id
    and (public.is_teacher_for_session(ls.id) or public.is_staff_or_admin())
  order by s.display_name;
$$;
