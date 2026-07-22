import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findAuthUserByEmail,
  hasConflictingParentLink
} from '../../lib/parent-invitation.ts';

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

test('auth lookup scans beyond the first 1,000 users and stops at the final page', async () => {
  const requestedPages: number[] = [];
  const found = await findAuthUserByEmail('TARGET@TECM.TEST', async (page, perPage) => {
    requestedPages.push(page);
    if (page <= 10) {
      return Array.from({ length: perPage }, (_, index) => ({
        id: `user-${page}-${index}`,
        email: `user-${page}-${index}@tecm.test`
      }));
    }
    return [{ id: 'target-user', email: 'target@tecm.test' }];
  });

  assert.deepEqual(found, { id: 'target-user', email: 'target@tecm.test' });
  assert.deepEqual(requestedPages, [1,2,3,4,5,6,7,8,9,10,11]);

  const absentPages: number[] = [];
  const absent = await findAuthUserByEmail('absent@tecm.test', async (page) => {
    absentPages.push(page);
    return [];
  });
  assert.equal(absent, null);
  assert.deepEqual(absentPages, [1]);
});
