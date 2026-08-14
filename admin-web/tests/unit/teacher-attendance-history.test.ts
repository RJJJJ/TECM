import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const read = (relative: string) => readFileSync(`${root}/${relative}`, 'utf8');

const migration = read('../supabase/migrations/202608140014_teacher_attendance_history_access.sql');
const page = read('app/admin/attendance/page.tsx');
const form = read('components/teacher-attendance-form.tsx');
const actions = read('lib/operations/actions.ts');
const errors = read('lib/operations/errors.ts');
const shell = read('components/admin-shell.tsx');

test('teacher attendance history has server-enforced assignment, tenant, and write boundaries', () => {
  assert.match(migration, /create or replace function public\.get_teacher_attendance_sessions\(\)/);
  assert.match(migration, /om\.role = 'teacher'/);
  assert.match(migration, /tp\.id = ls\.teacher_id/);
  assert.match(migration, /create or replace function public\.submit_teacher_attendance/);
  assert.match(migration, /if not exists \(\s+select 1 from public\.teacher_profiles tp/);
  assert.match(migration, /teacher is not assigned to this session/);
  assert.match(migration, /student is not active in this session cohort/);
  assert.match(migration, /drop policy if exists attendance_teacher_write_own_session on public\.attendance_records/);
  assert.match(migration, /create policy attendance_teacher_read_assigned/);
  assert.match(migration, /create policy attendance_staff_manage/);
  assert.match(migration, /if not public\.can_manage_organization\(session_organization_id\) then raise exception 'staff authorization required'/);
});

test('teacher history corrections are guarded, idempotent, auditable, and concurrency-safe', () => {
  assert.match(migration, /future session attendance is not allowed/);
  assert.match(migration, /if session_row\.starts_at > now\(\) then raise exception 'future session attendance is not allowed'/);
  assert.match(migration, /attendance correction reason is required/);
  assert.match(migration, /attendance has changed; reload before submitting/);
  assert.match(migration, /target_expected_updated_at is distinct from attendance_row\.updated_at/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /attendance is linked to finalized leave or makeup records/);
  assert.match(migration, /create or replace function public\.capture_attendance_history_audit/);
  assert.match(migration, /for each row execute function public\.capture_attendance_history_audit\(\)/);
  assert.match(migration, /'request_id'/);
  assert.match(migration, /'actor_role'/);
  assert.match(migration, /return jsonb_build_object\('changed', false/);
  assert.match(errors, /課堂尚未開始，暫時不能點名。/);
  assert.match(errors, /請重新載入後再提交。/);
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
  assert.match(actions, /rpc\('submit_teacher_attendance'/);
  assert.match(shell, /\['課堂與點名', '\/admin\/attendance'/);
});
