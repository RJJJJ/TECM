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
