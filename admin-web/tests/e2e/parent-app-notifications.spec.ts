import { expect, test } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const adminEmail = process.env.PLAYWRIGHT_ADMIN_EMAIL;
const adminPassword = process.env.PLAYWRIGHT_ADMIN_PASSWORD;
const organizationId = '10000000-0000-4000-8000-000000000000';
const otherOrganizationId = '20000000-0000-4000-8000-000000000000';
const activeParentUserId = '10000000-0000-4000-8000-000000000003';

test.describe('家長 App 帳戶與通知', () => {
  test.skip(
    !apiUrl || !anonKey || !serviceRoleKey || !adminEmail || !adminPassword,
    '需要本機 Supabase、service role 測試 fixture 及 seed admin credentials'
  );

  test('邀請、原子停用、範本、公告、投遞摘要及跨 tenant 防護', async ({ page }, testInfo) => {
    const runId = `${Date.now()}-${testInfo.project.name.replace(/[^a-z0-9]/gi, '-')}`;
    const guardianName = `App 驗收家長 ${runId}`;
    const guardianEmail = `parent-${runId}@tecm.test`;
    const announcementTitle = `App 測試公告 ${runId}`;
    const templateKey = `app_test_${Date.now()}_${testInfo.project.name.startsWith('desktop') ? 'desktop' : 'mobile'}`;
    const deviceToken = (testInfo.project.name.startsWith('desktop') ? 'd' : 'e').repeat(64);
    const service = createClient(apiUrl!, serviceRoleKey!, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const { data: guardian, error: guardianError } = await service
      .from('parent_profiles')
      .insert({ organization_id: organizationId, full_name: guardianName, account_status: 'unlinked' })
      .select('id')
      .single();
    expect(guardianError).toBeNull();

    const { error: deviceError } = await service.from('push_devices').upsert(
      {
        organization_id: organizationId,
        user_id: activeParentUserId,
        installation_id: `playwright-${testInfo.project.name}`,
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

    const disabledDeviceToken = (testInfo.project.name.startsWith('desktop') ? 'a' : 'b').repeat(64);
    const { error: linkedDeviceError } = await service.from('push_devices').insert({
      organization_id: organizationId,
      user_id: linkedProfile!.user_id,
      installation_id: `disable-target-${testInfo.project.name}`,
      device_token: disabledDeviceToken,
      environment: 'sandbox',
      bundle_id: 'app.TECM',
      is_active: true
    });
    expect(linkedDeviceError).toBeNull();
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
      template_key: `forbidden_${Date.now()}`,
      name: 'Forbidden',
      category: 'announcement',
      title: 'Forbidden',
      body: 'Forbidden cross-tenant write'
    });
    expect(crossTenantError).not.toBeNull();
  });
});
