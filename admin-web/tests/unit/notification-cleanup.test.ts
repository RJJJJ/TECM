import assert from 'node:assert/strict';
import test from 'node:test';
import { NotificationCleanupError, runBestEffortNotificationCleanup } from '../e2e/notification-cleanup.ts';

test('notification cleanup continues after a forced failure and aggregates sanitized stages', async () => {
  const calls: string[] = [];

  await assert.rejects(
    runBestEffortNotificationCleanup([
      {
        resource: 'notification_announcements',
        stage: 'lookup',
        run: async () => {
          calls.push('announcement lookup');
          throw new Error('service-role-secret-must-not-escape');
        }
      },
      {
        resource: 'notification_templates',
        stage: 'delete',
        run: async () => {
          calls.push('template delete');
        }
      },
      {
        resource: 'auth_user',
        stage: 'delete',
        run: async () => {
          calls.push('auth user delete');
        }
      }
    ], { timeoutMs: 100 }),
    (error) => {
      assert.ok(error instanceof NotificationCleanupError);
      assert.deepEqual(error.failures, [{ resource: 'notification_announcements', stage: 'lookup' }]);
      assert.doesNotMatch(error.message, /service-role-secret/);
      return true;
    }
  );

  assert.deepEqual(calls, ['announcement lookup', 'template delete', 'auth user delete']);
});

test('notification cleanup reports a timeout without waiting forever', async () => {
  const started = Date.now();

  await assert.rejects(
    runBestEffortNotificationCleanup([
      { resource: 'push_devices', stage: 'delete', run: () => new Promise<void>(() => {}) }
    ], { timeoutMs: 20 }),
    (error) => error instanceof NotificationCleanupError && error.message === 'notification cleanup failed: push_devices/delete'
  );

  assert.ok(Date.now() - started < 1_000);
});
