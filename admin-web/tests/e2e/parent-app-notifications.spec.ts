import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { createHash, randomUUID } from 'node:crypto';
import {
  assertCredentialedE2EEnvironment,
  credentialedE2ELocalOptOutEnabled,
  credentialedE2EEnvironment,
} from './required-env';
import {
  buildPushDeviceCleanupSteps,
  runBestEffortNotificationCleanup,
  type NotificationCleanupStep,
  type PushDeviceCleanupTarget
} from './notification-cleanup';

const localOptOut = credentialedE2ELocalOptOutEnabled();
const missingValue = localOptOut ? undefined : 'missing-required-e2e-value';
const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? missingValue;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? missingValue;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? missingValue;
const adminEmail = process.env.PLAYWRIGHT_ADMIN_EMAIL ?? missingValue;
const adminPassword = process.env.PLAYWRIGHT_ADMIN_PASSWORD ?? missingValue;
const credentialedEnvironment = credentialedE2EEnvironment();
const organizationId = '10000000-0000-4000-8000-000000000000';
const otherOrganizationId = '20000000-0000-4000-8000-000000000000';
const activeParentUserId = '10000000-0000-4000-8000-000000000003';
const canonicalRunId = JSON.parse(execFileSync(
  process.execPath,
  [resolve(process.cwd(), 'scripts/test-run-identity.mjs')],
  { env: process.env, encoding: 'utf8' }
).trim()).canonicalId;

test.beforeAll(() => {
  assertCredentialedE2EEnvironment(credentialedEnvironment);
});

test.describe('家長 App 帳戶與通知', () => {
  test.skip(
    !apiUrl || !anonKey || !serviceRoleKey || !adminEmail || !adminPassword,
    '需要本機 Supabase、service role 測試 fixture 及 seed admin credentials'
  );

  test('邀請、原子停用、範本、公告、投遞摘要及跨 tenant 防護', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const runId = `${canonicalRunId}-${testInfo.project.name.replace(/[^a-z0-9]/gi, '-')}`;
    const runKey = runId.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    const guardianName = `App 驗收家長 ${runId}`;
    const guardianEmail = `parent-${runId}@tecm.test`;
    const announcementTitle = `App 測試公告 ${runId}`;
    const templateKey = `app_test_${runKey}`.slice(0, 64);
    const installationId = `playwright-${runKey}`;
    const disableInstallationId = `disable-target-${runKey}`;
    const deviceToken = createHash('sha256').update(`${runId}:active`).digest('hex');
    const disabledDeviceToken = createHash('sha256').update(`${runId}:disabled`).digest('hex');
    const controlDeviceToken = createHash('sha256').update(`${runId}:control`).digest('hex');
    const forbiddenTemplateKey = `forbidden_${runKey}`;
    const targetDevice: PushDeviceCleanupTarget = {
      organizationId,
      userId: activeParentUserId,
      installationId
    };
    const service = createClient(apiUrl!, serviceRoleKey!, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    let guardianId: string | undefined;
    let linkedAuthUserId: string | undefined;
    let announcementId: string | undefined;
    let controlOrganizationId: string | undefined;
    let controlUserId: string | undefined;
    let controlDevice: PushDeviceCleanupTarget | undefined;
    let primaryError: unknown;

    try {
      controlOrganizationId = randomUUID();
      const controlEmail = `control-${runKey}-${controlOrganizationId}@tecm.test`;
      const controlPassword = randomUUID();
      const { error: controlOrganizationError } = await service.from('organizations').insert({
        id: controlOrganizationId,
        slug: `e2e-control-${runKey}-${controlOrganizationId.slice(0, 8)}`,
        name: `E2E control tenant ${runId}`,
        timezone: 'Asia/Macau',
        currency_code: 'MOP'
      });
      expect(controlOrganizationError).toBeNull();

      const { data: controlUser, error: controlUserError } = await service.auth.admin.createUser({
        email: controlEmail,
        password: controlPassword,
        email_confirm: true
      });
      expect(controlUserError).toBeNull();
      controlUserId = controlUser?.user?.id;
      if (!controlUserId) throw new Error('control fixture user was not created');

      // push_devices is unique by (user_id, installation_id), so this deliberately
      // exercises the same installation_id in two different synthetic tenants.
      // The control user does not need an organization membership: service-role
      // access is intentional here, and membership audit rows are append-only and
      // would prevent exact control-organization teardown.
      const { error: controlDeviceError } = await service.from('push_devices').insert({
        organization_id: controlOrganizationId,
        user_id: controlUserId,
        installation_id: installationId,
        device_token: controlDeviceToken,
        environment: 'sandbox',
        bundle_id: 'app.TECM',
        is_active: true
      });
      expect(controlDeviceError).toBeNull();
      controlDevice = {
        organizationId: controlOrganizationId,
        userId: controlUserId,
        installationId
      };

      const { data: guardian, error: guardianError } = await service
      .from('parent_profiles')
      .insert({ organization_id: organizationId, full_name: guardianName, account_status: 'unlinked' })
      .select('id')
      .single();
      expect(guardianError).toBeNull();
      guardianId = guardian?.id;

    const { error: deviceError } = await service.from('push_devices').upsert(
      {
        organization_id: organizationId,
        user_id: activeParentUserId,
        installation_id: installationId,
        device_token: deviceToken,
        environment: 'sandbox',
        bundle_id: 'app.TECM',
        is_active: true
      },
      { onConflict: 'user_id,installation_id' }
    );
    expect(deviceError).toBeNull();

    await page.goto('/login');
    await page.getByLabel('電郵').fill(adminEmail!);
    await page.getByLabel('密碼').fill(adminPassword!);
    await page.getByRole('button', { name: '登入' }).click();
    await expect(page).toHaveURL(/\/admin\/dashboard$/, { timeout: 30_000 });

    await page.goto('/admin/guardians');
    const guardianRow = page.getByRole('row').filter({ hasText: guardianName });
    await guardianRow.getByPlaceholder('parent@example.com').fill(guardianEmail);
    await guardianRow.getByRole('button', { name: '發送邀請' }).click();
    await expect(guardianRow).toContainText('已邀請', { timeout: 30_000 });

    const { data: linkedProfile, error: linkedError } = await service
      .from('parent_profiles')
      .select('user_id,email,account_status')
      .eq('id', guardian!.id)
      .single();
    expect(linkedError).toBeNull();
    expect(linkedProfile).toMatchObject({ email: guardianEmail, account_status: 'invited' });
    expect(linkedProfile!.user_id).toBeTruthy();
    linkedAuthUserId = linkedProfile!.user_id;

    const { error: linkedDeviceError } = await service.from('push_devices').insert({
      organization_id: organizationId,
      user_id: linkedProfile!.user_id,
      installation_id: disableInstallationId,
      device_token: disabledDeviceToken,
      environment: 'sandbox',
      bundle_id: 'app.TECM',
      is_active: true
    });
    expect(linkedDeviceError).toBeNull();
    page.once('dialog', (dialog) => dialog.accept());
    await guardianRow.getByRole('button', { name: '停用帳戶及裝置' }).click();
    await expect(guardianRow).toContainText('已停用', { timeout: 30_000 });
    const [{ data: disabledProfile }, { data: disabledDevice }] = await Promise.all([
      service.from('parent_profiles').select('account_status').eq('id', guardian!.id).single(),
      service.from('push_devices').select('is_active').eq('device_token', disabledDeviceToken).single()
    ]);
    expect(disabledProfile?.account_status).toBe('disabled');
    expect(disabledDevice?.is_active).toBe(false);

    await page.goto('/admin/notifications');
    const templatePanel = page.getByText('建立／更新範本').locator('..');
    await templatePanel.getByPlaceholder('識別碼，例如 class_reminder').fill(templateKey);
    await templatePanel.getByPlaceholder('範本名稱').fill(`App 測試範本 ${runId}`);
    await templatePanel.getByPlaceholder('通知標題').fill('課堂資料已更新');
    await templatePanel.getByPlaceholder('通知內容').fill('請登入 App 查看完整資料。');
    await templatePanel.getByRole('button', { name: '儲存範本' }).click();
    await expect(page.getByText(templateKey)).toBeVisible({ timeout: 30_000 });

    await page.getByLabel('標題').fill(announcementTitle);
    await page.getByLabel('內容').fill('這是只寫入本機 Supabase 的驗收公告。');
    await page.getByRole('button', { name: '立即發送' }).click();
    await expect(page.getByRole('row').filter({ hasText: announcementTitle })).toContainText('1', {
      timeout: 30_000
    });

    const { data: announcement, error: announcementError } = await service
      .from('notification_announcements')
      .select('id,recipient_count')
      .eq('title', announcementTitle)
      .single();
    expect(announcementError).toBeNull();
    announcementId = announcement?.id;
    expect(announcement!.recipient_count).toBe(1);

    const { data: notification, error: notificationError } = await service
      .from('notifications')
      .select('id')
      .eq('entity_type', 'announcement')
      .eq('entity_id', announcement!.id)
      .single();
    expect(notificationError).toBeNull();
    const { count: notificationPendingCount, error: outboxError } = await service
      .from('notification_outbox')
      .select('id', { count: 'exact', head: true })
      .eq('notification_id', notification!.id)
      .eq('status', 'pending');
    expect(outboxError).toBeNull();
    expect(notificationPendingCount).toBeGreaterThanOrEqual(1);
    const { count: totalPendingCount, error: totalOutboxError } = await service
      .from('notification_outbox')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('status', 'pending');
    expect(totalOutboxError).toBeNull();
    await expect(page.getByText('處理／重試中').locator('..')).toContainText(String(totalPendingCount));
    await expect(page.locator('body')).not.toContainText(deviceToken);

    const authenticated = createClient(apiUrl!, anonKey!, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    const { error: loginError } = await authenticated.auth.signInWithPassword({
      email: adminEmail!,
      password: adminPassword!
    });
    expect(loginError).toBeNull();
    const { error: crossTenantError } = await authenticated.from('notification_templates').insert({
      organization_id: otherOrganizationId,
      template_key: forbiddenTemplateKey,
      name: 'Forbidden',
      category: 'announcement',
      title: 'Forbidden',
      body: 'Forbidden cross-tenant write'
    });
    expect(crossTenantError).not.toBeNull();
    } catch (error) {
      primaryError = error;
      throw error;
    } finally {
      let announcementIds = Array.from(new Set([announcementId].filter((id): id is string => Boolean(id))));
      const cleanupErrors: unknown[] = [];
      const rememberCleanupError = (error: unknown) => {
        if (cleanupErrors.length === 0) cleanupErrors.push(error);
      };
      const cleanupSteps: NotificationCleanupStep[] = [
        {
          resource: 'parent_profile',
          stage: 'lookup',
          run: async () => {
            if (guardianId) return;
            const { data: createdProfile, error } = await service
              .from('parent_profiles')
              .select('id,user_id')
              .eq('organization_id', organizationId)
              .eq('full_name', guardianName)
              .maybeSingle();
            if (error) throw error;
            guardianId = createdProfile?.id ?? undefined;
            linkedAuthUserId = createdProfile?.user_id ?? linkedAuthUserId;
          }
        },
        {
          resource: 'notification_announcements',
          stage: 'lookup',
          run: async () => {
            const { data, error } = await service
              .from('notification_announcements')
              .select('id')
              .eq('organization_id', organizationId)
              .eq('title', announcementTitle);
            if (error) throw error;
            announcementIds = Array.from(new Set([
              ...announcementIds,
              ...(data ?? []).map((item) => item.id)
            ].filter((id): id is string => Boolean(id))));
          }
        },
        {
          resource: 'notifications',
          stage: 'delete',
          run: async () => {
            if (announcementIds.length === 0) return;
            const { error } = await service
              .from('notifications')
              .delete()
              .eq('entity_type', 'announcement')
              .in('entity_id', announcementIds);
            if (error) throw error;
          }
        },
        {
          resource: 'notification_announcements',
          stage: 'delete',
          run: async () => {
            if (announcementIds.length === 0) return;
            const { error } = await service
              .from('notification_announcements')
              .delete()
              .in('id', announcementIds);
            if (error) throw error;
          }
        },
        {
          resource: 'notification_templates',
          stage: 'delete',
          run: async () => {
            const { error } = await service
              .from('notification_templates')
              .delete()
              .eq('organization_id', organizationId)
              .eq('template_key', templateKey);
            if (error) throw error;
          }
        },
        {
          resource: 'parent_profile',
          stage: 'lookup_auth_user',
          run: async () => {
            if (!guardianId || linkedAuthUserId) return;
            const { data, error } = await service
              .from('parent_profiles')
              .select('user_id')
              .eq('id', guardianId)
              .maybeSingle();
            if (error) throw error;
            linkedAuthUserId = data?.user_id ?? undefined;
          }
        },
        ...buildPushDeviceCleanupSteps(service, [
          targetDevice
        ]),
        {
          resource: 'notification_templates',
          stage: 'cross_tenant_cleanup',
          run: async () => {
            const { error } = await service
              .from('notification_templates')
              .delete()
              .eq('organization_id', otherOrganizationId)
              .eq('template_key', forbiddenTemplateKey);
            if (error) throw error;
          }
        },
        {
          resource: 'parent_profile',
          stage: 'delete',
          run: async () => {
            if (!guardianId) return;
            const { error } = await service
              .from('parent_profiles')
              .delete()
              .eq('id', guardianId);
            if (error) throw error;
          }
        },
        {
          resource: 'auth_user',
          stage: 'delete',
          run: async () => {
            if (!linkedAuthUserId) return;
            const { error } = await service.auth.admin.deleteUser(linkedAuthUserId);
            if (error) throw error;
          }
        }
      ];

      let targetBefore: number | undefined;
      let controlBefore: number | undefined;
      if (controlDevice) {
        try {
          const targetCount = await service
            .from('push_devices')
            .select('id', { count: 'exact', head: true })
            .eq('organization_id', targetDevice.organizationId)
            .eq('user_id', targetDevice.userId)
            .eq('installation_id', targetDevice.installationId);
          expect(targetCount.error).toBeNull();
          targetBefore = targetCount.count ?? 0;

          const controlCount = await service
            .from('push_devices')
            .select('id', { count: 'exact', head: true })
            .eq('organization_id', controlDevice.organizationId)
            .eq('user_id', controlDevice.userId)
            .eq('installation_id', controlDevice.installationId);
          expect(controlCount.error).toBeNull();
          controlBefore = controlCount.count ?? 0;
          expect(targetBefore).toBe(1);
          expect(controlBefore).toBe(1);
        } catch (error) {
          rememberCleanupError(error);
        }
      }

      try {
        await runBestEffortNotificationCleanup(cleanupSteps);
      } catch (error) {
        rememberCleanupError(error);
      }

      if (linkedAuthUserId) {
        try {
          await runBestEffortNotificationCleanup(buildPushDeviceCleanupSteps(service, [{
            organizationId,
            userId: linkedAuthUserId,
            installationId: disableInstallationId
          }]));
        } catch (error) {
          rememberCleanupError(error);
        }
      }

      if (controlDevice && targetBefore !== undefined && controlBefore !== undefined) {
        try {
          const targetAfterCount = await service
            .from('push_devices')
            .select('id', { count: 'exact', head: true })
            .eq('organization_id', targetDevice.organizationId)
            .eq('user_id', targetDevice.userId)
            .eq('installation_id', targetDevice.installationId);
          expect(targetAfterCount.error).toBeNull();

          const controlAfterCount = await service
            .from('push_devices')
            .select('id', { count: 'exact', head: true })
            .eq('organization_id', controlDevice.organizationId)
            .eq('user_id', controlDevice.userId)
            .eq('installation_id', controlDevice.installationId);
          expect(controlAfterCount.error).toBeNull();

          const residueCount = await service
            .from('push_devices')
            .select('id', { count: 'exact', head: true })
            .eq('organization_id', targetDevice.organizationId)
            .in('installation_id', [installationId, disableInstallationId]);
          expect(residueCount.error).toBeNull();

          const targetAfter = targetAfterCount.count ?? 0;
          const controlAfter = controlAfterCount.count ?? 0;
          const residue = residueCount.count ?? 0;
          console.info(JSON.stringify({
            target_before: targetBefore,
            target_after: targetAfter,
            control_before: controlBefore,
            control_after: controlAfter,
            residue_count: residue
          }));
          expect(targetAfter).toBe(0);
          expect(controlAfter).toBe(1);
          expect(residue).toBe(0);
        } catch (error) {
          rememberCleanupError(error);
        }
      }

      const controlCleanupSteps: NotificationCleanupStep[] = [];
      if (controlDevice) controlCleanupSteps.push(...buildPushDeviceCleanupSteps(service, [controlDevice]));
      if (controlOrganizationId && controlUserId) {
        controlCleanupSteps.push(
          {
            resource: 'auth_user',
            stage: 'control_delete',
            run: async () => {
              const { error } = await service.auth.admin.deleteUser(controlUserId!);
              if (error) throw error;
            }
          }
        );
      }
      if (controlOrganizationId) {
        controlCleanupSteps.push({
          resource: 'organization',
          stage: 'control_delete',
          run: async () => {
            const { error } = await service
              .from('organizations')
              .delete()
              .eq('id', controlOrganizationId!);
            if (error) throw error;
          }
        });
      }
      if (controlCleanupSteps.length > 0) {
        try {
          await runBestEffortNotificationCleanup(controlCleanupSteps);
        } catch (error) {
          rememberCleanupError(error);
        }
      }

      if (!primaryError && cleanupErrors.length > 0) {
        throw cleanupErrors[0];
      }
    }
  });
});
