import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { safeErrorMessage } from '../../lib/operations/errors.ts';

const root = resolve(import.meta.dirname, '../..');
const source = (path: string) => readFileSync(resolve(root, path), 'utf8');
const migration = source('../supabase/migrations/20260830100127_batch1_staff_attendance_operation_idempotency.sql');
const forms = source('components/operation-forms.tsx');
const actions = source('lib/operations/actions.ts');
const page = source('app/admin/attendance/page.tsx');

test('Batch 1 staff attendance shares the revision, lock, lifecycle, and replay contract', () => {
  assert.match(migration, /create or replace function public\.submit_staff_attendance\(\s*target_session_id uuid,[\s\S]+?target_expected_revision bigint/, 'B1-M1 staff expected revision missing');
  assert.match(migration, /if attendance_row\.id is null then\s+if target_expected_revision is not null[\s\S]+?target_expected_revision <> attendance_row\.revision/, 'B1-M1 staff stale/null revision guard missing');
  assert.match(migration, /if not pg_try_advisory_xact_lock\(hashtextextended\(\s*'teacher-attendance:'/, 'B1-M2 shared nonblocking attendance lock missing');
  assert.match(migration, /om\.status = 'active'[\s\S]+?om\.role in \('admin', 'staff'\)/, 'B1-M3 active staff authorization missing');
  assert.match(migration, /attendance cannot be submitted for a cancelled session/);
  assert.match(migration, /future session attendance is not allowed/);
  assert.match(migration, /attendance correction reason is required/);
  assert.match(migration, /attendance is linked to finalized leave or makeup records/);
  assert.match(migration, /request_seen := found[\s\S]+?'idempotent_replay', true/);
});

test('Batch 1 removes direct authenticated attendance DML and the legacy RPC', () => {
  assert.match(migration, /revoke insert, update, delete on table public\.attendance_records from authenticated;/, 'B1-M4 direct authenticated attendance DML revoke missing');
  assert.match(migration, /create policy attendance_staff_read\s+on public\.attendance_records for select/);
  assert.match(migration, /drop function if exists public\.submit_attendance\(uuid,jsonb\);/);
  assert.doesNotMatch(actions, /rpc\('submit_attendance'/);
});

test('Batch 1 payment and intake keys are bound to canonical server fingerprints', () => {
  assert.match(migration, /create or replace function public\.operation_payload_fingerprint\(payload jsonb\)/);
  assert.match(migration, /'operation', 'record_payment'[\s\S]+?'amount_minor', target_amount_minor[\s\S]+?'method', normalized_method/);
  assert.match(migration, /payment_row\.request_fingerprint <> request_fingerprint[\s\S]+?idempotency key payload mismatch/, 'B1-M5 payment payload comparison missing');
  assert.match(migration, /'operation', 'create_guardian_student_enrollment_package'[\s\S]+?'school_name', normalized_school_name[\s\S]+?'fee_plan_id', target_fee_plan_id/);
  assert.match(migration, /existing_fingerprint <> request_fingerprint[\s\S]+?idempotency key payload mismatch/, 'B1-M6 intake payload comparison missing');
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\(\s*'record-payment:'/);
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\(\s*'intake-package:'/);
});

test('mounted operation forms rotate keys only after confirmed success and remain pending-safe', () => {
  assert.match(actions, /completionToken: crypto\.randomUUID\(\)/);
  assert.match(forms, /if \(state\.status !== 'success' \|\| !state\.completionToken\) return;[\s\S]+?input\.defaultValue = state\.completionToken;[\s\S]+?input\.value = state\.completionToken;/, 'B1-M7 success key rotation missing');
  assert.match(forms, /useActionState\(createGuardianStudentAction, initial\)/);
  assert.match(forms, /useActionState\(recordPaymentAction, initial\)/);
  assert.match(forms, /disabled=\{disabled \|\| pending\}/);
  assert.match(forms, /onSubmit=\{ensureIdempotencyKey\}/);
});

test('staff UI loads authoritative revisions and submits no client-selected organization', () => {
  assert.match(page, /from\('attendance_records'\)\.select\('session_id,student_id,status,revision'\)/);
  assert.match(forms, /name="expected_revision" value=\{student\.revision \?\? ''\}/);
  assert.match(actions, /!form\.has\('expected_revision'\)/);
  assert.match(actions, /rpc\('submit_staff_attendance'/);
  assert.doesNotMatch(forms, /name="organization_id"/);
});

test('sensitive database mismatch and attendance conflicts map to exact safe operator messages', () => {
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const mismatch = safeErrorMessage({ code: 'P0001', message: 'idempotency key payload mismatch 123e4567-e89b-12d3-a456-426614174000 person@example.test SELECT * FROM payments' });
    assert.equal(mismatch, '表單內容已在提交後改變。請重新整理頁面，再重新操作。');
    assert.doesNotMatch(mismatch, /123e4567|example|select|payments|P0001/i);
    const stale = safeErrorMessage({ code: 'P0001', message: 'attendance has changed; reload before submitting private-row-token' });
    assert.equal(stale, '此點名已被其他操作更新，請重新載入後再提交。');
    assert.doesNotMatch(stale, /private|token|P0001/i);
  } finally {
    console.error = originalConsoleError;
  }
});
