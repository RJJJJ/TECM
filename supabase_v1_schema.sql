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

-- 2.12 notifications
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

-- 7.8 optional staff role sample
-- Replace the placeholder UUID with a real auth.users.id before execution.
-- insert into public.staff_roles (user_id, role, is_active)
-- values ('<REAL_AUTH_USER_UUID>', 'admin', true)
-- on conflict (user_id) do update set role = excluded.role, is_active = excluded.is_active, updated_at = now();

-- 7.9 bind real parent auth user id (run after parent signs up)
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
    'news_items', 'faq_topics', 'faq_items', 'bookings', 'booking_status_logs', 'notifications'
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

-- 8.4 verify RLS is enabled
select schemaname, tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in (
    'staff_roles', 'parent_profiles', 'children', 'campuses', 'courses', 'course_tags',
    'news_items', 'faq_topics', 'faq_items', 'bookings', 'booking_status_logs', 'notifications'
  )
order by tablename;
