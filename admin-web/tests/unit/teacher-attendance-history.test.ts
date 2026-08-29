import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { safeErrorMessage } from '../../lib/operations/errors.ts';

const root = fileURLToPath(new URL('../..', import.meta.url));
const read = (relative: string) => readFileSync(`${root}/${relative}`, 'utf8');

const migration = read('../supabase/migrations/202608140014_teacher_attendance_history_access.sql');
const revisionMigration = read('../supabase/migrations/20260825150954_teacher_attendance_revision_guard.sql');
const page = read('app/admin/attendance/page.tsx');
const form = read('components/teacher-attendance-form.tsx');
const actions = read('lib/operations/actions.ts');
const errors = read('lib/operations/errors.ts');
const shell = read('components/admin-shell.tsx');

test('teacher attendance history has server-enforced assignment, tenant, and write boundaries', () => {
  assert.match(migration, /create or replace function public\.get_teacher_attendance_sessions\(\)/);
  assert.match(migration, /om\.role = 'teacher'/);
  assert.match(migration, /tp\.id = ls\.teacher_id/);
  assert.match(revisionMigration, /create or replace function public\.submit_teacher_attendance/);
  assert.match(
    revisionMigration,
    /if not exists \(\s+select 1 from public\.teacher_profiles tp/,
    'M30 assignment guard missing'
  );
  assert.match(revisionMigration, /teacher is not assigned to this session/);
  assert.match(revisionMigration, /student is not active in this session cohort/);
  assert.match(migration, /drop policy if exists attendance_teacher_write_own_session on public\.attendance_records/);
  assert.match(migration, /create policy attendance_teacher_read_assigned/);
  assert.match(migration, /create policy attendance_staff_manage/);
  assert.match(migration, /if not public\.can_manage_organization\(session_organization_id\) then raise exception 'staff authorization required'/);
});

test('teacher history corrections are guarded, idempotent, auditable, and concurrency-safe', () => {
  assert.match(revisionMigration, /add column if not exists revision bigint not null default 1/);
  assert.match(revisionMigration, /new\.revision := old\.revision \+ 1/, 'M33 monotonic revision increment missing');
  assert.match(revisionMigration, /before insert or update on public\.attendance_records/);
  assert.match(revisionMigration, /drop function if exists public\.submit_teacher_attendance\(uuid,uuid,text,timestamptz,text,text\)/);
  assert.match(
    revisionMigration,
    /target_expected_revision <> attendance_row\.revision/,
    'M39 stale revision equality guard missing'
  );
  assert.match(revisionMigration, /if attendance_row\.id is null then\s+if target_expected_revision is not null/);
  assert.match(revisionMigration, /future session attendance is not allowed/);
  assert.match(
    revisionMigration,
    /if session_row\.starts_at > now\(\) then raise exception 'future session attendance is not allowed'/,
    'M32 future-session denial missing'
  );
  assert.match(revisionMigration, /attendance correction reason is required/);
  assert.match(revisionMigration, /attendance has changed; reload before submitting/);
  assert.match(
    revisionMigration,
    /if not pg_try_advisory_xact_lock\(hashtextextended\([\s\S]+?raise exception 'attendance update is already in progress'/,
    'M40 non-blocking attendance contention guard missing'
  );
  assert.match(revisionMigration, /request_seen := found/);
  assert.match(revisionMigration, /'idempotent_replay', true/);
  assert.match(revisionMigration, /attendance is linked to finalized leave or makeup records/);
  assert.match(migration, /create or replace function public\.capture_attendance_history_audit/);
  assert.match(
    migration,
    /for each row execute function public\.capture_attendance_history_audit\(\)/,
    'M31 attendance history audit trigger missing'
  );
  assert.match(migration, /'request_id'/);
  assert.match(migration, /'actor_role'/);
  assert.match(migration, /return jsonb_build_object\('changed', false/);
  assert.match(errors, /課堂尚未開始，暫時不能點名。/);
  assert.match(errors, /請重新載入後再提交。/);
  assert.match(errors, /此點名資料正在由另一位使用者更新，請重新整理後再試。/);
});

test('teacher UI exposes Chinese filters and never renders raw identity values', () => {
  for (const label of ['課堂與點名', '今天', '最近 7 日', '即將開始', '全部課堂', '開始日期', '結束日期', '學生姓名']) {
    assert.ok(page.includes(label), `missing teacher UI label: ${label}`);
  }
  assert.match(page, /get_teacher_attendance_sessions/);
  assert.match(page, /get_lesson_session_students/);
  assert.doesNotMatch(page, />\{session\.session_id\}</);
  assert.doesNotMatch(page, />\{student\.student_id\}</);
  assert.match(form, /修改原因（必填）/);
  assert.match(form, /crypto\.randomUUID\(\)/);
  assert.match(form, /name="expected_revision"/);
  assert.match(page, /select\('student_id,revision'\)/);
  assert.match(actions, /rpc\('submit_teacher_attendance'/);
  assert.match(actions, /target_expected_revision: expectedRevision/);
  assert.match(shell, /\['課堂與點名', '\/admin\/attendance'/);
});

test('attendance contention maps to one sanitized operator message', () => {
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const message = safeErrorMessage({
      code: 'P0001',
      message: 'attendance update is already in progress: internal SQL tenant row token'
    });
    assert.equal(message, '此點名資料正在由另一位使用者更新，請重新整理後再試。');
    assert.doesNotMatch(message, /SQL|tenant|row|token|P0001/i);
  } finally {
    console.error = originalConsoleError;
  }
});
