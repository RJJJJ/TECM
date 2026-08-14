import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../../..');
const source = (path: string) => readFileSync(resolve(root, path), 'utf8');

test('cohort enrollment uses the guarded idempotent state transition and refreshes every listing', () => {
  const migration = source('supabase/migrations/202608050012_uat_core_workflows.sql');
  const action = source('admin-web/app/admin/exam-cohorts/actions.ts');
  const detail = source('admin-web/app/admin/exam-cohorts/[id]/page.tsx');

  assert.match(migration, /create or replace function public\.enroll_student_in_cohort/);
  assert.match(migration, /public\.can_manage_organization\(target_organization_id\)/);
  assert.match(migration, /existing_enrollment\.status = 'active'/);
  assert.match(migration, /set status = 'active', left_at = null/);
  assert.match(migration, /result_status := 'reactivated'/);
  assert.match(migration, /ec\.organization_id = target_organization_id/);
  assert.match(migration, /ec\.course_id is null or c\.is_active/);
  assert.match(migration, /s\.organization_id = target_organization_id/);
  assert.match(action, /rpc\('enroll_student_in_cohort'/);
  assert.doesNotMatch(action, /from\('cohort_students'\)\.insert/);
  for (const path of ['/admin/exam-cohorts', '/admin/classes', '/admin/students', '/admin/dashboard']) {
    assert.match(action, new RegExp(`revalidatePath\\('${path.replaceAll('/', '\\/')}`));
  }
  assert.match(detail, /\.eq\('status', 'active'\)\.order\('created_at'\)/);
});

test('existing-parent multi-student workflow preserves identity and tenant boundaries', () => {
  const migration = source('supabase/migrations/202608050012_uat_core_workflows.sql');
  const actions = source('admin-web/app/admin/guardians/actions.ts');
  const page = source('admin-web/app/admin/guardians/page.tsx');

  assert.match(migration, /create or replace function public\.link_existing_parent_student/);
  assert.match(migration, /account_status = 'active'/);
  assert.match(migration, /parent_row\.user_id/);
  assert.match(migration, /student_row\.id/);
  assert.match(migration, /revoke insert, update, delete on public\.parent_student_links from authenticated/);
  assert.match(migration, /target_confirmed is not true/);
  assert.match(migration, /create trigger trg_parent_student_links_audit/);
  assert.match(actions, /rpc\('link_existing_parent_student'/);
  assert.match(actions, /rpc\('unlink_existing_parent_student'/);
  assert.doesNotMatch(actions, /auth\.admin\.createUser|parent_profiles'\)\.insert/);
  assert.match(page, /邀請／建立新家長身份/);
  assert.match(page, /將現有家長連結另一名學生/);
});

test('teacher is denied the operations dashboard before sensitive queries execute', () => {
  const dashboard = source('admin-web/app/admin/dashboard/page.tsx');
  const index = source('admin-web/app/admin/page.tsx');
  const shell = source('admin-web/components/admin-shell.tsx');
  const actions = source('admin-web/lib/operations/actions.ts');

  const guardPosition = dashboard.indexOf("if (context.role === 'teacher') redirect('/admin/attendance')");
  const queryPosition = dashboard.indexOf('Promise.all([');
  assert.ok(guardPosition > 0 && queryPosition > guardPosition, 'teacher guard must precede dashboard queries');
  assert.match(index, /role === 'teacher' \? '\/admin\/attendance' : '\/admin\/dashboard'/);
  assert.doesNotMatch(shell, /\['總覽', '\/admin\/dashboard', \['admin', 'staff', 'teacher'\]\]/);
  assert.match(shell, /role === 'teacher' \? '\/admin\/attendance'/);
  assert.match(actions, /if \(!\['admin', 'staff'\]\.includes\(role\)\) throw userFacingError/);
});

test('expected form errors stay in action state and login credentials are localized safely', () => {
  const guardianActions = source('admin-web/app/admin/guardians/actions.ts');
  const guardianForms = source('admin-web/app/admin/guardians/guardian-account-actions.tsx');
  const leaveAction = source('admin-web/lib/operations/actions.ts');
  const leaveForm = source('admin-web/app/admin/leave-makeup/leave-decision-form.tsx');
  const login = source('admin-web/app/login/actions.ts');
  const errors = source('admin-web/lib/operations/errors.ts');

  assert.match(guardianActions, /Promise<GuardianActionState>/);
  assert.doesNotMatch(guardianActions, /throw safeActionError/);
  assert.match(guardianForms, /useActionState\(inviteGuardianAction, initialState\)/);
  assert.match(leaveAction, /decideLeaveRequestAction\(_: OperationState, form: FormData\): Promise<OperationState>/);
  assert.match(leaveForm, /useActionState\(decideLeaveRequestAction, initialState\)/);
  assert.match(login, /電郵或密碼不正確。/);
  assert.doesNotMatch(login, /error\.message/);
  assert.match(errors, /Never log the provider message/);
  assert.doesNotMatch(errors, /console\.error\([^\n]*message/);
});
