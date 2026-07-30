import { expect, test } from '@playwright/test';

test('login renders without the deprecated ReactDOM useFormState warning', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.goto('/login');
  await expect(page.locator('form')).toBeVisible();
  expect(consoleErrors).not.toContainEqual(expect.stringContaining('ReactDOM.useFormState'));
});

const email = process.env.PLAYWRIGHT_ADMIN_EMAIL;
const password = process.env.PLAYWRIGHT_ADMIN_PASSWORD;

test.describe('教育中心營運主流程', () => {
  test.skip(!email || !password, '需要 seed 後的 PLAYWRIGHT_ADMIN_EMAIL / PLAYWRIGHT_ADMIN_PASSWORD');

  test('招生、報讀、收費、點名、扣堂、請假、補課及跟進', async ({ page }, testInfo) => {
    const runId = Date.now().toString();
    const studentName = `驗收學生 ${runId}`;

    await page.goto('/login');
    await page.getByLabel('電郵').fill(email!);
    await page.getByLabel('密碼').fill(password!);
    await page.getByRole('button', { name: '登入' }).click();
    await expect(page).toHaveURL(/\/admin\/dashboard$/, { timeout: 30_000 });

    await page.goto('/admin/students');
    await page.getByLabel('家長姓名').fill(`驗收家長 ${runId}`);
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
});
