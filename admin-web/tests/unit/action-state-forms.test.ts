import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const adminWebRoot = resolve(import.meta.dirname, '../..');

function source(path: string) {
  return readFileSync(resolve(adminWebRoot, path), 'utf8');
}

test('login form uses React useActionState with the existing Server Action and pending button', () => {
  const loginForm = source('app/login/login-form.tsx');

  assert.match(loginForm, /import \{[^}]*useActionState[^}]*\} from 'react';/);
  assert.match(loginForm, /useActionState\(loginAction, INITIAL_STATE\)/);
  assert.match(loginForm, /useFormStatus\(\)/);
  assert.match(loginForm, /data-hydrated=\{hydrated \? 'true' : 'false'\}/);
  assert.doesNotMatch(loginForm, /useFormState/);
});

test('intake form retains action-state, FormData, idempotency, and result wiring', () => {
  const forms = source('components/operation-forms.tsx');

  assert.match(forms, /useActionState\(createGuardianStudentAction, initial\)/);
  assert.match(forms, /onSubmit=\{ensureIdempotencyKey\}/);
  assert.match(forms, /name="idempotency_key"/);
  assert.match(forms, /<Result state=\{state\}\/>/);
  assert.doesNotMatch(forms, /useFormState/);
});
