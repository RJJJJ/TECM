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
const organizationId = process.env.TECM_ORGANIZATION_ID;

test.beforeAll(() => {
  if (supabaseUrl && !/^http:\/\/127\.0\.0\.1(?::\d+)?$/.test(supabaseUrl)) {
    throw new Error(`Credentialed education E2E is local-only; refusing Supabase URL ${supabaseUrl}`);
  }
});

type CreatedFixture = {
  prefix: string;
  studentName: string;
  guardianName: string;
  campusName: string;
  courseName: string;
  cohortName: string;
  feePlanName: string;
};

function macauDateInput(offsetDays: number, time?: string) {
  const date = new Date(Date.now() + offsetDays * 86_400_000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Macau', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  const value = `${part('year')}-${part('month')}-${part('day')}`;
  return time ? `${value}T${time}` : value;
}

async function cleanupAdminUxFixture(client: SupabaseClient, fixture: CreatedFixture) {
  let studentsQuery = client.from('students').select('id,organization_id').eq('display_name', fixture.studentName);
  if (organizationId) studentsQuery = studentsQuery.eq('organization_id', organizationId);
  const { data: students, error: studentError } = await studentsQuery;
  if (studentError) throw studentError;
  const studentIds = (students ?? []).map((student) => student.id);
  if (!studentIds.length) {
    if (!organizationId) return;
    const { data: cohorts, error: cohortError } = await client.from('exam_cohorts').select('id').eq('organization_id', organizationId).eq('name', fixture.cohortName);
    if (cohortError) throw cohortError;
    const cohortIds = (cohorts ?? []).map((item) => item.id);
    if (cohortIds.length) {
      const { error } = await client.from('lesson_sessions').update({ status: 'cancelled' }).eq('organization_id', organizationId).in('cohort_id', cohortIds).eq('status', 'scheduled');
      if (error) throw error;
      const { error: cohortUpdateError } = await client.from('exam_cohorts').update({ status: 'cancelled' }).eq('organization_id', organizationId).in('id', cohortIds);
      if (cohortUpdateError) throw cohortUpdateError;
    }
    for (const [table, column, value] of [
      ['fee_plans', 'name', fixture.feePlanName],
      ['courses', 'title', fixture.courseName],
      ['campuses', 'name', fixture.campusName]
    ] as const) {
      const { error } = await client.from(table).update({ is_active: false }).eq('organization_id', organizationId).eq(column, value);
      if (error) throw error;
    }
    return;
  }

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

    const { data: cohorts, error: cohortLookupError } = await client.from('exam_cohorts').select('id').eq('organization_id', organizationId).eq('name', fixture.cohortName);
    if (cohortLookupError) throw cohortLookupError;
    const cohortIds = (cohorts ?? []).map((item) => item.id);
    if (cohortIds.length) {
      const { error: sessionUpdateError } = await client.from('lesson_sessions').update({ status: 'cancelled' }).eq('organization_id', organizationId).in('cohort_id', cohortIds).eq('status', 'scheduled');
      if (sessionUpdateError) throw sessionUpdateError;
      const { error: cohortUpdateError } = await client.from('exam_cohorts').update({ status: 'cancelled' }).eq('organization_id', organizationId).in('id', cohortIds);
      if (cohortUpdateError) throw cohortUpdateError;
    }
    const { error: planUpdateError } = await client.from('fee_plans').update({ is_active: false }).eq('organization_id', organizationId).eq('name', fixture.feePlanName);
    if (planUpdateError) throw planUpdateError;
    const { error: courseUpdateError } = await client.from('courses').update({ is_active: false }).eq('organization_id', organizationId).eq('title', fixture.courseName);
    if (courseUpdateError) throw courseUpdateError;
    const { error: campusUpdateError } = await client.from('campuses').update({ is_active: false }).eq('organization_id', organizationId).eq('name', fixture.campusName);
    if (campusUpdateError) throw campusUpdateError;
  }
}

test.describe('教育中心營運主流程', () => {
  test.skip(!email || !password || !supabaseUrl || !serviceRoleKey || !organizationId, '需要 seed 管理員、Supabase service role 及本機 E2E 環境');
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
    const campusName = `${prefix}_CAMPUS`;
    const courseName = `${prefix}_COURSE`;
    const cohortName = `${prefix}_COHORT`;
    const feePlanName = `${prefix}_PACKAGE`;
    fixture = { prefix, studentName, guardianName, campusName, courseName, cohortName, feePlanName };
    test.setTimeout(180_000);
    const adminClient = createClient(supabaseUrl!, serviceRoleKey!, { auth: { persistSession: false, autoRefreshToken: false } });
    const assertPersisted = async (table: string, filters: Record<string, string>) => {
      let query = adminClient.from(table).select('id').eq('organization_id', organizationId!);
      for (const [key, value] of Object.entries(filters)) query = query.eq(key, value);
      const { data, error } = await query;
      expect(error).toBeNull();
      expect(data?.length ?? 0).toBeGreaterThan(0);
    };

    await page.goto('/login');
    await page.getByLabel('電郵').fill(email!);
    await page.getByLabel('密碼').fill(password!);
    await page.getByRole('button', { name: '登入' }).click();
    await expect(page).toHaveURL(/\/admin\/dashboard$/, { timeout: 30_000 });

    await page.goto('/admin/settings');
    await page.getByLabel('校區名稱').fill(campusName);
    await page.getByLabel('校區地址').fill('澳門測試地址');
    await page.getByRole('button', { name: '建立校區' }).click();
    await expect(page.getByRole('status')).toContainText('校區已建立');
    await page.reload();
    await expect(page.getByText(campusName)).toBeVisible();

    await page.goto('/admin/courses');
    await page.getByLabel('課程名稱').fill(courseName);
    await page.getByLabel('類別').fill('Python');
    await page.getByLabel('程度').fill('測試');
    await page.getByLabel('校區').selectOption({ label: campusName });
    await page.getByRole('button', { name: '新增課程' }).click();
    await expect(page.getByRole('status')).toContainText('課程已新增');
    await page.reload();
    await expect(page.getByText(courseName)).toBeVisible();

    await page.goto('/admin/packages');
    await page.getByLabel('套票名稱').fill(feePlanName);
    await page.getByLabel('適用課程').selectOption({ label: courseName });
    await page.getByLabel('堂數').fill('8');
    await page.getByLabel('金額（仙）').fill('120000');
    await page.getByRole('button', { name: '建立套票' }).click();
    await expect(page.getByRole('status')).toContainText('套票已建立');
    await page.reload();
    await expect(page.getByText(feePlanName)).toBeVisible();

    await page.goto('/admin/exam-cohorts');
    await page.getByLabel('班別名稱').fill(cohortName);
    await page.getByLabel('科目').first().selectOption('Python');
    await page.getByLabel('程度').first().fill('測試');
    await page.getByLabel('考試日期').fill(macauDateInput(90));
    await page.getByLabel('上課日').selectOption('saturday');
    await page.getByLabel('導師').selectOption({ index: 1 });
    await page.getByLabel('班別狀態').selectOption('active');
    await page.getByRole('button', { name: '建立班別' }).click();
    await expect(page.getByRole('status')).toContainText('班別已建立');
    await page.reload();
    await assertPersisted('campuses', { name: campusName });
    await assertPersisted('courses', { title: courseName });
    await assertPersisted('fee_plans', { name: feePlanName });
    await assertPersisted('exam_cohorts', { name: cohortName });
    const cohortRow = page.getByRole('row').filter({ hasText: cohortName });
    const cohortHref = await cohortRow.getByRole('link', { name: '開啟班別' }).getAttribute('href');
    expect(cohortHref).toBeTruthy();

    await page.goto(`${cohortHref}/lesson-plans`);
    await page.getByLabel('第 1 堂教學內容').fill('測試教學內容');
    await page.getByRole('button', { name: '儲存教案' }).click();
    await expect(page.getByRole('status')).toContainText('教案已儲存');

    await page.goto(`${cohortHref}/lesson-sessions`);
    await page.getByLabel('教案').selectOption({ index: 1 });
    await page.getByLabel('導師').selectOption({ index: 1 });
    await page.getByLabel('開始時間').fill(macauDateInput(0, '09:00'));
    await page.getByLabel('結束時間').fill(macauDateInput(0, '10:00'));
    await page.getByRole('button', { name: '建立未來課堂' }).click();
    await expect(page.getByText('未來課堂已建立')).toBeVisible();
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await page.getByLabel('教案').selectOption({ index: 2 });
    await page.getByLabel('導師').selectOption({ index: 1 });
    await page.getByLabel('開始時間').fill(macauDateInput(2, '09:00'));
    await page.getByLabel('結束時間').fill(macauDateInput(2, '10:00'));
    await page.getByRole('button', { name: '建立未來課堂' }).click();
    await expect(page.locator('tbody tr')).toHaveCount(2);
    const persistedCohort = await adminClient.from('exam_cohorts').select('id').eq('organization_id', organizationId!).eq('name', cohortName).single();
    expect(persistedCohort.error).toBeNull();
    const persistedPlans = await adminClient.from('lesson_plans').select('id').eq('organization_id', organizationId!).eq('cohort_id', persistedCohort.data!.id);
    expect(persistedPlans.error).toBeNull();
    expect(persistedPlans.data?.length ?? 0).toBeGreaterThan(0);
    const persistedSessions = await adminClient.from('lesson_sessions').select('id').eq('organization_id', organizationId!).eq('cohort_id', persistedCohort.data!.id);
    expect(persistedSessions.error).toBeNull();
    expect(persistedSessions.data?.length ?? 0).toBe(2);

    await page.goto('/admin/students');
    await page.getByLabel('家長姓名').fill(guardianName);
    await page.getByLabel('電話').fill('66881234');
    await page.getByLabel('學生姓名').fill(studentName);
    await page.getByLabel('班別').selectOption({ label: cohortName });
    await page.getByLabel('套票').selectOption({ label: feePlanName });
    await page.getByRole('button', { name: '建立資料' }).click();
    await expect(page.getByRole('status')).toContainText('已建立');
    await page.reload();
    await assertPersisted('students', { display_name: studentName });
    await assertPersisted('parent_profiles', { full_name: guardianName });
    await expect(page.getByText(studentName).first()).toBeVisible();

    await page.goto('/admin/payments');
    const chargeValue = await page.getByLabel('收費項目').locator('option').filter({ hasText: studentName }).getAttribute('value');
    await page.getByLabel('收費項目').selectOption(chargeValue!);
    await page.getByLabel('付款金額（仙）').fill('120000');
    await page.getByRole('button', { name: '確認收款' }).click();
    await expect(page.getByRole('status')).toContainText('付款已記錄');
    const persistedStudent = await adminClient.from('students').select('id').eq('organization_id', organizationId!).eq('display_name', studentName).single();
    expect(persistedStudent.error).toBeNull();
    await assertPersisted('cohort_students', { student_id: persistedStudent.data!.id });
    await assertPersisted('student_packages', { student_id: persistedStudent.data!.id });
    const persistedPayments = await adminClient.from('payments').select('id').eq('organization_id', organizationId!).eq('amount_minor', '120000');
    expect(persistedPayments.error).toBeNull();
    expect(persistedPayments.data?.length ?? 0).toBeGreaterThan(0);

    await page.goto('/admin/attendance');
    const studentGroup = page.getByRole('group', { name: studentName });
    await studentGroup.getByText('出席').click();
    const attendancePanel = studentGroup.locator('xpath=ancestor::form');
    await attendancePanel.getByRole('button', { name: '提交整班點名' }).click();
    await expect(attendancePanel.getByRole('status')).toContainText('已儲存');
    await attendancePanel.getByRole('button', { name: '提交整班點名' }).click();
    await expect(attendancePanel.getByRole('status')).toContainText('不會重複扣堂');

    await assertPersisted('attendance_records', { student_id: persistedStudent.data!.id });
    await page.goto('/admin/packages');
    await expect(page.getByText(studentName).first()).toBeVisible();

    await page.goto('/admin/leave-makeup');
    await page.getByLabel('請假學生').selectOption({ label: studentName });
    const leaveSession = await page.getByLabel('原課堂').locator('option').filter({ hasText: cohortName }).last().getAttribute('value');
    await page.getByLabel('原課堂').selectOption(leaveSession!);
    await page.getByLabel('請假原因').fill('家庭安排');
    await page.getByRole('button', { name: '提交請假' }).click();
    const leaveRow = page.getByRole('row').filter({ hasText: studentName }).filter({ hasText: '家庭安排' });
    await expect(leaveRow).toBeVisible();
    await leaveRow.getByRole('button', { name: '批准及建立補課額' }).click();
    const entitlementValue = await page.getByLabel('可用補課額').locator('option').filter({ hasText: studentName }).getAttribute('value');
    await page.getByLabel('可用補課額').selectOption(entitlementValue!);
    await page.getByLabel('補課導師').selectOption({ index: 1 });
    const makeupTime = testInfo.project.name === 'teacher-mobile' ? '2027-01-10T11:00' : '2027-01-10T10:00';
    await page.getByLabel('補課時間').fill(makeupTime);
    await page.getByRole('button', { name: '預約補課' }).click();
    await expect(page.getByRole('status').filter({ hasText: '補課預約已建立' })).toBeVisible();
    await assertPersisted('leave_requests', { student_id: persistedStudent.data!.id, status: 'approved' });
    await assertPersisted('makeup_sessions', { student_id: persistedStudent.data!.id, status: 'scheduled' });

    await page.goto('/admin/makeup');
    const makeupRow = page.getByRole('row').filter({ hasText: studentName });
    const makeupHref = await makeupRow.getByRole('link', { name: '開啟詳情' }).getAttribute('href');
    expect(makeupHref).toBeTruthy();
    await page.goto(makeupHref!);
    await expect(page.getByRole('button', { name: '標記為已完成' })).toBeVisible();
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: '標記為已完成' }).click();
    await expect(page.getByRole('status').filter({ hasText: '補課已完成' })).toBeVisible();
    await assertPersisted('makeup_tasks', { student_id: persistedStudent.data!.id, status: 'completed' });
    await assertPersisted('makeup_sessions', { student_id: persistedStudent.data!.id, status: 'completed' });
    await assertPersisted('makeup_entitlements', { student_id: persistedStudent.data!.id, status: 'consumed' });

    await page.goto('/admin/dashboard');
    await expect(page.getByRole('heading', { name: '營運儀表板' })).toBeVisible();
    await expect(page.getByText('建立有效校區')).toBeVisible();
    await expect(page.getByText('建立學生及家長資料')).toBeVisible();
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
