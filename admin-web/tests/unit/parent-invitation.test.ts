import assert from 'node:assert/strict';
import test from 'node:test';
import { hasConflictingParentLink } from '../../lib/parent-invitation.ts';

const target = { id: 'parent-a', organization_id: 'org-a', user_id: null };

test('parent invitation preflight permits a new identity and the same existing link', () => {
  assert.equal(hasConflictingParentLink(target, null, []), false);
  assert.equal(hasConflictingParentLink(
    { ...target, user_id: 'user-a' },
    'user-a',
    [{ ...target, user_id: 'user-a' }]
  ), false);
});

test('parent invitation preflight rejects relinking a profile or identity', () => {
  assert.equal(hasConflictingParentLink({ ...target, user_id: 'user-a' }, null, []), true);
  assert.equal(hasConflictingParentLink({ ...target, user_id: 'user-a' }, 'user-b', []), true);
  assert.equal(hasConflictingParentLink(target, 'user-a', [
    { id: 'parent-b', organization_id: 'org-b', user_id: 'user-a' }
  ]), true);
});
