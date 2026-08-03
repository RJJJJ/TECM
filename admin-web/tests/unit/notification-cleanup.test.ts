import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPushDeviceCleanupSteps,
  NotificationCleanupError,
  runBestEffortNotificationCleanup
} from '../e2e/notification-cleanup.ts';

test('push-device cleanup preserves a colliding installation in another organization', async () => {
  const installationId = 'collision-installation';
  const rows = [
    { organization_id: 'org-a', user_id: 'user-a', installation_id: installationId },
    { organization_id: 'org-b', user_id: 'user-b', installation_id: installationId }
  ];
  const calls: Array<Array<[string, string]>> = [];
  const service = {
    from(table: string) {
      assert.equal(table, 'push_devices');
      return {
        delete() {
          const filters: Array<[string, string]> = [];
          calls.push(filters);
          const builder = {
            eq(column: string, value: string) {
              filters.push([column, value]);
              return builder;
            },
            then(resolve: (value: { error: null }) => unknown, reject: (reason: unknown) => unknown) {
              try {
                for (let index = rows.length - 1; index >= 0; index -= 1) {
                  if (filters.every(([column, value]) => rows[index][column as keyof typeof rows[number]] === value)) {
                    rows.splice(index, 1);
                  }
                }
                return Promise.resolve({ error: null }).then(resolve, reject);
              } catch (error) {
                return Promise.reject(error).then(resolve, reject);
              }
            }
          };
          return builder;
        }
      };
    }
  };

  const [cleanup] = buildPushDeviceCleanupSteps(service, [
    { organizationId: 'org-a', userId: 'user-a', installationId }
  ]);
  await cleanup.run();

  assert.deepEqual(rows, [
    { organization_id: 'org-b', user_id: 'user-b', installation_id: installationId }
  ]);
  assert.deepEqual(calls, [[
    ['organization_id', 'org-a'],
    ['user_id', 'user-a'],
    ['installation_id', installationId]
  ]]);
});

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
