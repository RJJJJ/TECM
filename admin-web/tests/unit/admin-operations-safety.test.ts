import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const adminWebRoot = resolve(import.meta.dirname, '../..');

function source(path: string) {
  return readFileSync(resolve(adminWebRoot, path), 'utf8');
}

test('operations context selects canonical active memberships and fails closed for ambiguity', () => {
  const context = source('lib/operations/context.ts');
  const access = source('lib/auth/staff-access.ts');

  assert.match(access, /from\('organization_members'\)/);
  assert.match(access, /\.eq\('status', 'active'\)/);
  assert.doesNotMatch(access, /\.limit\(1\)|staff_roles/);
  assert.match(context, /access\.memberships\.length > 1/);
  assert.match(context, /多個機構/);
});

test('admin writes carry the active organization and validate tenant-owned references', () => {
  const actionSources = [
    source('app/admin/courses/actions.ts'),
    source('app/admin/exam-cohorts/actions.ts'),
    source('app/admin/settings/actions.ts'),
    source('app/admin/teachers/actions.ts'),
    source('app/admin/packages/actions.ts'),
    source('app/admin/makeup/actions.ts')
  ].join('\n');

  assert.match(actionSources, /organization_id:\s*(?:context|verified\.context)\.organizationId/);
  assert.match(actionSources, /\.eq\('organization_id',\s*(?:context|verified\.context)\.organizationId\)/);
  assert.match(source('app/admin/exam-cohorts/actions.ts'), /lead_teacher_id/);
  assert.match(source('app/admin/exam-cohorts/actions.ts'), /teacher_profiles/);
  assert.match(source('app/admin/packages/actions.ts'), /course_id/);
  assert.match(source('app/admin/teachers/actions.ts'), /rpc\('link_teacher_profile'/);
  assert.doesNotMatch(source('app/admin/teachers/actions.ts'), /from\('organization_members'\)\.insert/);
  assert.match(source('lib/operations/actions.ts'), /rpc\('submit_staff_leave_request'/);
  assert.doesNotMatch(source('lib/operations/actions.ts'), /from\('leave_requests'\)\.insert/);
});

test('safe operation errors do not expose provider messages or internal UI identifiers', () => {
  const errors = source('lib/operations/errors.ts');
  const ui = source('components/operations-ui.tsx');

  assert.match(errors, /Never log the provider message/);
  assert.match(errors, /參考編號/);
  assert.match(errors, /PERMISSION_ERROR_MESSAGE/);
  assert.match(ui, /safeErrorMessage/);
  assert.match(ui, /statusLabel/);
  assert.doesNotMatch(source('app/admin/courses/page.tsx'), /error\.message/);
  assert.doesNotMatch(source('app/admin/exam-cohorts/page.tsx'), /error\.message/);
  assert.match(errors, /這名學生沒有報讀所選課堂的班別/);
  assert.match(errors, /此登入身份已連結其他機構或其他職員角色/);
});

test('intake cannot dead-end on empty setup selections', () => {
  const forms = source('components/operation-forms.tsx');
  assert.match(forms, /建立班別/);
  assert.match(forms, /建立套票/);
  assert.match(forms, /disabled=\{!classes\.length\}/);
  assert.match(forms, /disabled=\{!plans\.length\}/);
  assert.match(forms, /export function LeaveForm/);
  assert.match(forms, /createLeaveRequestAction, initial\).*return <form action=\{action\} onSubmit=\{ensureIdempotencyKey\}/);
});

test('tenant foreign-key protection remains present in the database contract', () => {
  const migration = source('../supabase/migrations/202607110002_invariants_rls_rpcs.sql');
  assert.match(migration, /force row level security/);
  assert.match(migration, /enforce_tenant_foreign_keys/);
  assert.match(migration, /cross-organization reference denied/);
  assert.match(migration, /'fee_plans'/);
  assert.match(migration, /'student_packages'/);
});

test('admin integrity migration makes teacher linking atomic and leave creation guarded', () => {
  const migration = source('../supabase/migrations/202608020009_admin_operations_integrity.sql');
  assert.match(migration, /create or replace function public\.link_teacher_profile/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /identity already has a different organization role/);
  assert.match(migration, /create or replace function public\.submit_staff_leave_request/);
  assert.match(migration, /join public\.cohort_students/);
  assert.match(migration, /ls\.status = 'scheduled'/);
  assert.match(migration, /revoke insert, update, delete on public\.leave_requests from authenticated/);
});

test('makeup detail actions use the canonical RPCs and guarded completion UI', () => {
  const actions = source('app/admin/makeup/actions.ts');
  const form = source('app/admin/makeup/makeup-session-forms.tsx');
  assert.match(actions, /rpc\('book_makeup_session'/);
  assert.match(actions, /rpc\('complete_makeup_task'/);
  assert.doesNotMatch(actions, /from\('makeup_sessions'\)\.insert|from\('makeup_tasks'\)\.update/);
  assert.match(form, /window\.confirm/);
  assert.match(form, /useFormStatus/);
});

test('booking equality is rejected in both client and Server Action validation', () => {
  const serverAction = source('app/admin/bookings/[id]/actions.ts');
  const clientForm = source('app/admin/bookings/[id]/booking-update-form.tsx');
  assert.match(serverAction, /startTime >= endTime/);
  assert.match(clientForm, /startTime >= endTime/);
  assert.match(serverAction, /開始時間必須早於結束時間/);
  assert.match(clientForm, /開始時間必須早於結束時間/);
});

test('normal operator pages do not render raw identity UUIDs', () => {
  assert.doesNotMatch(source('app/admin/teachers/page.tsx'), /使用者 ID|>\s*\{?teacher\.user_id\}?/);
  assert.doesNotMatch(source('app/admin/settings/page.tsx'), /organizationId\}|>\s*\{?member\.user_id\}?/);
  for (const path of [
    'app/admin/courses/[id]/page.tsx',
    'app/admin/news/[id]/page.tsx',
    'app/admin/faq/topics/[id]/page.tsx',
    'app/admin/faq/items/[id]/page.tsx'
  ]) assert.doesNotMatch(source(path), /編號：/);
});

test('teacher directory failure remains sanitized and keeps inactive rows visible with disabled identity actions', () => {
  const page = source('app/admin/teachers/page.tsx');

  assert.match(page, /directoryUnavailable = true/);
  assert.match(page, /role="alert"/);
  assert.match(page, /暫時無法讀取導師登入目錄。/);
  assert.match(page, /導師名單仍會顯示/);
  assert.match(page, /請稍後重試/);
  assert.match(page, /href="\/admin\/teachers">重新載入/);
  assert.match(page, /teachers\.map/);
  assert.match(page, /statusLabel\(teacher\.is_active \? 'active' : 'inactive'\)/);
  assert.match(page, /type="button" disabled/);
  assert.match(page, /const canReactivate = !teacher\.is_active && role === 'admin' && Boolean\(email\)/);
  assert.match(page, /canReactivate \? <TeacherReactivateForm email=\{email!\}/);
  assert.match(page, /暫時無法取得登入電郵/);
  assert.doesNotMatch(page, /catch\s*\([^)]*\)\s*{[^}]*\.message|error\.message|access_token|refresh_token|provider_token|service_role/);
});

test('operator-facing statuses and setup validation use Traditional Chinese labels', async () => {
  const { statusLabel } = await import('../../lib/operations/labels.ts');
  assert.equal(statusLabel('attendance_deduction'), '出席扣堂');
  assert.equal(statusLabel('available'), '可使用');
  assert.equal(statusLabel('approved'), '已批准');
  assert.equal(statusLabel('inactive'), '已停用');
  assert.equal(statusLabel('scheduled'), '已排課');
  assert.equal(statusLabel('failed'), '失敗');
  assert.equal(statusLabel(statusLabel('completed')), '已完成');
  assert.doesNotMatch(source('app/admin/courses/[id]/actions.ts'), /Title 為必填|Sort order|Campus 不存在|Tag /);
  assert.match(source('app/admin/exam-cohorts/cohort-create-form.tsx'), /班別狀態/);
});

test('targeted admin status surfaces call statusLabel instead of rendering raw enum text', () => {
  const targets = [
    'app/admin/classes/page.tsx',
    'app/admin/leave-makeup/page.tsx',
    'app/admin/makeup/page.tsx',
    'app/admin/notifications/page.tsx',
    'app/admin/sessions/page.tsx',
    'app/admin/makeup/schedule/page.tsx'
  ];

  for (const path of targets) {
    const page = source(path);
    assert.match(page, /statusLabel/);
    assert.doesNotMatch(page, /<Badge[^>\n]*>\{(?:item|row|task|session)\.(?:status|priority)\}<\/Badge>/);
  }
});

test('credentialed Admin E2E is loopback-only and release results cannot silently skip', () => {
  const environment = source('tests/e2e/required-env.ts');
  const resultVerifier = source('scripts/verify-playwright-results.mjs');
  const reporter = source('scripts/playwright-result-reporter.mjs');
  const workflow = readFileSync(resolve(adminWebRoot, '../.github/workflows/release-validation.yml'), 'utf8');

  assert.match(environment, /LOCAL_E2E_ORGANIZATION_ID/);
  assert.match(environment, /127\\.0\\.0\\.1/);
  assert.match(environment, /TECM_E2E_ALLOW_MISSING_SUPABASE/);
  assert.match(environment, /must use the deterministic local organization/);
  assert.match(resultVerifier, /release validation never accepts skipped tests/);
  assert.match(resultVerifier, /PLAYWRIGHT_RUN_ID/);
  assert.match(resultVerifier, /GITHUB_SHA/);
  assert.match(reporter, /configuredProjects/);
  assert.match(reporter, /counts/);
  assert.match(workflow, /TECM_ORGANIZATION_ID='10000000-0000-4000-8000-000000000000'/);
  assert.match(workflow, /npm run test:e2e:verify/);
  assert.doesNotMatch(workflow, /GITHUB_ENV/);
});
