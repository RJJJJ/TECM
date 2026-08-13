import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const read = (relative: string) => readFileSync(`${root}/${relative}`, 'utf8');

const migration = read('../supabase/migrations/202608130013_course_cohort_enrollment_model.sql');
const actions = read('app/admin/exam-cohorts/actions.ts');
const createForm = read('app/admin/exam-cohorts/cohort-create-form.tsx');
const transferForm = read('app/admin/exam-cohorts/cohort-transfer-form.tsx');
const linkForm = read('app/admin/exam-cohorts/cohort-course-link-form.tsx');
const detailPage = read('app/admin/exam-cohorts/[id]/page.tsx');
const errors = read('lib/operations/errors.ts');

test('Cohort creation requires an active Course and derives category and level', () => {
  assert.match(actions, /if \(!courseId\) return \{ status: 'error', message: '請先選擇所屬課程。' \}/);
  assert.match(actions, /\.eq\('is_active', true\)/);
  assert.match(actions, /course_id: course\.id/);
  assert.match(actions, /subject: course\.category/);
  assert.match(actions, /level: course\.level/);
  assert.match(createForm, /name="course_id"/);
  assert.doesNotMatch(createForm, /name="subject"/);
  assert.doesNotMatch(createForm, /name="level"/);
  assert.match(createForm, /選擇課程後顯示名稱、類別及程度/);
});
test('all enrollment business outcomes use explicit Traditional Chinese messages', () => {
  for (const message of [
    '學生已加入班別。',
    '學生已在此班別，現有報讀記錄保持有效。',
    '學生的舊報讀記錄已恢復',
    '學生已報讀此課程的另一班別。如需更換，請使用轉班。',
    '此班別尚未連結課程，請先選擇所屬課程。'
  ]) assert.ok(`${actions}\n${errors}\n${detailPage}`.includes(message), `missing message: ${message}`);
});

test('transfer and legacy Course link are separate confirmed Server Actions', () => {
  assert.match(actions, /rpc\('transfer_student_between_cohorts'/);
  assert.match(actions, /rpc\('link_cohort_to_course'/);
  assert.match(transferForm, /name="confirmed" value="true" required/);
  assert.match(transferForm, /學生：/);
  assert.match(transferForm, /目前班別：/);
  assert.match(transferForm, /目標班別/);
  assert.match(transferForm, /課程：/);
  assert.match(linkForm, /name="confirmed" value="true" required/);
  assert.match(linkForm, /現有班別：/);
});

test('expected business failures stay in action state and provider details stay private', () => {
  assert.match(actions, /return \{ status: 'error', message:/);
  assert.match(actions, /safeOperationMessage\(error, '轉班失敗/);
  assert.match(actions, /safeOperationMessage\(error, '連結課程失敗/);
  assert.doesNotMatch(actions, /redirect\(/);
  assert.match(errors, /Never log the provider message/);
  assert.doesNotMatch(errors, /return .*errorText\(error\)/);
});

test('database contract is Course-scoped, locked, audited, and direct-DML protected', () => {
  assert.match(migration, /drop index if exists public\.unique_active_exam_membership/);
  assert.match(migration, /create or replace function public\.transfer_student_between_cohorts/);
  assert.match(migration, /create or replace function public\.link_cohort_to_course/);
  assert.match(migration, /security definer[\s\S]*set search_path = public/);
  assert.match(migration, /student-enrollment:/);
  assert.match(migration, /course-enrollment:/);
  assert.match(migration, /revoke insert, update, delete on public\.cohort_students from authenticated/);
  assert.match(migration, /trg_exam_cohorts_audit/);
  assert.doesNotMatch(migration, /update public\.exam_cohorts[\s\S]{0,120}where course_id is null/);
});
