import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

test('login renders without the deprecated ReactDOM useFormState warning', async ({ page }) => {
  const consoleMessages: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') consoleMessages.push(message.text());
  });

  await page.goto('/login');
  await expect(page.locator('form[data-hydrated="true"]')).toBeVisible();
  await page.waitForTimeout(1_000);
  expect(consoleMessages).not.toContainEqual(expect.stringContaining('ReactDOM.useFormState'));
});

const email = process.env.PLAYWRIGHT_ADMIN_EMAIL;
const password = process.env.PLAYWRIGHT_ADMIN_PASSWORD;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

type CreatedFixture = { prefix: string; studentName: string; guardianName: string };

async function cleanupAdminUxFixture(client: SupabaseClient, fixture: CreatedFixture) {
  const { data: students, error: studentError } = await client.from('students').select('id,organization_id').eq('display_name', fixture.studentName);
  if (studentError) throw studentError;
  const studentIds = (students ?? []).map((student) => student.id);
  if (!studentIds.length) return;

  const organizationIds = [...new Set((students ?? []).map((student) => student.organization_id))];
  for (const organizationId of organizationIds) {
    const { data: packages, error: packageError } = await client.from('student_packages').select('id').eq('organization_id', organizationId).in('student_id', studentIds);
    if (packageError) throw packageError;
    const packageIds = (packages ?? []).map((item) => item.id);
    const { data: charges, error: chargeError } = await client.from('charges').select('id').eq('organization_id', organizationId).in('student_id', studentIds);
    if (chargeError) throw chargeError;
    const chargeIds = (charges ?? []).map((item) => item.id);
    if (chargeIds.length) {
      const { data: allocations, error: allocationError } = await client.from('payment_allocations').select('payment_id').eq('organization_id', organizationId).in('charge_id', chargeIds);
      if (allocationError) throw allocationError;
      const paymentIds = [...new Set((allocations ?? []).map((item) => item.payment_id))];
      if (paymentIds.length) {
        const { error } = await client.from('payments').update({ status: 'void' }).eq('organization_id', organizationId).in('id', paymentIds);
        if (error) throw error;
      }
      const { error } = await client.from('charges').update({ status: 'void' }).eq('organization_id', organizationId).in('id', chargeIds);
      if (error) throw error;
    }
    if (packageIds.length) {
      const { error } = await client.from('student_packages').update({ status: 'cancelled' }).eq('organization_id', organizationId).in('id', packageIds);
      if (error) throw error;
    }
    for (const table of ['leave_requests', 'makeup_entitlements', 'makeup_sessions', 'makeup_tasks'] as const) {
      const { error } = await client.from(table).update({ status: 'cancelled' }).eq('organization_id', organizationId).in('student_id', studentIds);
      if (error) throw error;
    }
    const { error: communicationError } = await client.from('communication_logs').update({ status: 'failed' }).eq('organization_id', organizationId).in('student_id', studentIds).eq('status', 'queued');
    if (communicationError) throw communicationError;
    const { error: cohortError } = await client.from('cohort_students').update({ status: 'withdrawn', left_at: new Date().toISOString().slice(0, 10) }).eq('organization_id', organizationId).in('student_id', studentIds).eq('status', 'active');
    if (cohortError) throw cohortError;
    const { error: studentUpdateError } = await client.from('students').update({ status: 'inactive' }).eq('organization_id', organizationId).in('id', studentIds);
    if (studentUpdateError) throw studentUpdateError;
    const { error: parentError } = await client.from('parent_profiles').update({ account_status: 'disabled' }).eq('organization_id', organizationId).eq('full_name', fixture.guardianName);
    if (parentError) throw parentError;
  }
}

test.describe('教育中心營運主流程', () => {
  test.skip(!email || !password || !supabaseUrl || !serviceRoleKey, '需要 seed 管理員、Supabase service role 及本機 E2E 環境');
  let fixture: CreatedFixture | null = null;

  test.afterEach(async () => {
    if (!fixture || !supabaseUrl || !serviceRoleKey) return;
    const client = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    await cleanupAdminUxFixture(client, fixture);
    fixture = null;
  });

  test('招生、報讀、收費、點名、扣堂、請假、補課及跟進', async ({ page }, testInfo) => {
    const prefix = `TEST_ADMIN_UX_${Date.now()}`;
    const studentName = `${prefix}_STUDENT`;
    const guardianName = `${prefix}_PARENT`;
    fixture = { prefix, studentName, guardianName };

    await page.goto('/login');
    await page.getByLabel('電郵').fill(email!);
    await page.getByLabel('密碼').fill(password!);
    await page.getByRole('button', { name: '登入' }).click();
    await expect(page).toHaveURL(/\/admin\/dashboard$/, { timeout: 30_000 });

    await page.goto('/admin/students');
    await page.getByLabel('家長姓名').fill(guardianName);
    await page.getByLabel('電話').fill('66881234');
    await page.getByLabel('學生姓名').fill(studentName);
    await page.getByLabel('班別').selectOption({ index: 1 });
    await page.getByLabel('套票').selectOption({ index: 1 });
    await page.getByRole('button', { name: '建立資料' }).click();
    await expect(page.getByRole('status')).toContainText('已建立');
    await page.reload();
    await expect(page.getByText(studentName).first()).toBeVisible();

    await page.goto('/admin/payments');
    const chargeValue = await page.getByLabel('收費項目').locator('option').filter({ hasText: studentName }).getAttribute('value');
    await page.getByLabel('收費項目').selectOption(chargeValue!);
    await page.getByLabel('付款金額（仙）').fill('120000');
    await page.getByRole('button', { name: '確認收款' }).click();
    await expect(page.getByRole('status')).toContainText('付款已記錄');

    await page.goto('/admin/attendance');
    const studentGroup = page.getByRole('group', { name: studentName });
    await studentGroup.getByText('出席').click();
    const attendancePanel = studentGroup.locator('xpath=ancestor::form');
    await attendancePanel.getByRole('button', { name: '提交整班點名' }).click();
    await expect(attendancePanel.getByRole('status')).toContainText('已儲存');
    await attendancePanel.getByRole('button', { name: '提交整班點名' }).click();
    await expect(attendancePanel.getByRole('status')).toContainText('不會重複扣堂');

    await page.goto('/admin/packages');
    await expect(page.getByText(studentName).first()).toBeVisible();

    await page.goto('/admin/leave-makeup');
    await page.getByLabel('請假學生').selectOption({ label: studentName });
    await page.getByLabel('原課堂').selectOption({ index: 1 });
    await page.getByLabel('請假原因').fill('家庭安排');
    await page.getByRole('button', { name: '提交請假' }).click();
    await page.getByRole('button', { name: '批准及建立補課額' }).first().click();
    const entitlementValue = await page.getByLabel('可用補課額').locator('option').filter({ hasText: studentName }).getAttribute('value');
    await page.getByLabel('可用補課額').selectOption(entitlementValue!);
    await page.getByLabel('補課導師').selectOption({ index: 1 });
    const makeupTime = testInfo.project.name === 'teacher-mobile' ? '2027-01-10T11:00' : '2027-01-10T10:00';
    await page.getByLabel('補課時間').fill(makeupTime);
    await page.getByRole('button', { name: '預約補課' }).click();
    await expect(page.getByRole('status').filter({ hasText: '補課預約已建立' })).toBeVisible();

    await page.goto('/admin/dashboard');
    await expect(page.getByRole('heading', { name: '營運儀表板' })).toBeVisible();
    await page.goto('/admin/follow-ups');
    await expect(page).toHaveURL(/\/admin\/follow-ups$/);
    await expect(page.locator('main h2')).toBeVisible();
  });

  test('核心營運頁不會顯示內部錯誤或元件名稱', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('電郵').fill(email!);
    await page.getByLabel('密碼').fill(password!);
    await page.getByRole('button', { name: '登入' }).click();
    await expect(page).toHaveURL(/\/admin\/dashboard$/, { timeout: 30_000 });

    for (const path of ['/admin/students', '/admin/courses', '/admin/exam-cohorts', '/admin/leave-makeup', '/admin/makeup']) {
      await page.goto(path);
      const body = await page.locator('body').innerText();
      expect(body).not.toMatch(/row-level security policy|permission denied|PGRST|LessonPlanEditor|LessonSessionsPage|MakeupStudentListPage|error code/i);
    }
  });
});
