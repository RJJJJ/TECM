import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import {
  assertCredentialedE2EEnvironment,
  credentialedE2EEnvironment,
  credentialedE2ELocalOptOutEnabled
} from './required-env';

test('login renders without the deprecated ReactDOM useFormState warning', async ({ page }) => {
  const consoleMessages: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') consoleMessages.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/login');
  await expect(page.locator('form[data-hydrated="true"]')).toBeVisible();
  await page.waitForTimeout(1_000);
  expect(consoleMessages).not.toContainEqual(expect.stringContaining('ReactDOM.useFormState'));
  await page.getByLabel('電郵').fill('unknown-account@tecm.test');
  await page.getByLabel('密碼').fill('definitely-wrong');
  await page.getByRole('button', { name: '登入' }).click();
  await expect(page.getByText('電郵或密碼不正確。')).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator('body')).not.toContainText('Invalid login credentials');
  expect(pageErrors).toEqual([]);
  expect(consoleMessages.join('\n')).not.toMatch(/unhandled|stack trace|invalid login credentials/i);
});

const localOptOut = credentialedE2ELocalOptOutEnabled();
const missingValue = localOptOut ? undefined : 'missing-required-e2e-value';
const email = process.env.PLAYWRIGHT_ADMIN_EMAIL ?? missingValue;
const password = process.env.PLAYWRIGHT_ADMIN_PASSWORD ?? missingValue;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? missingValue;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? missingValue;
const organizationId = process.env.TECM_ORGANIZATION_ID ?? missingValue;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? missingValue;
const teacherEmail = process.env.PLAYWRIGHT_TEACHER_EMAIL ?? missingValue;
const teacherPassword = process.env.PLAYWRIGHT_TEACHER_PASSWORD ?? missingValue;
const parentEmail = process.env.PLAYWRIGHT_PARENT_EMAIL ?? missingValue;
const parentPassword = process.env.PLAYWRIGHT_PARENT_PASSWORD ?? missingValue;
const credentialedEnvironment = credentialedE2EEnvironment();
const canonicalRunId = JSON.parse(execFileSync(
  process.execPath,
  [resolve(process.cwd(), 'scripts/test-run-identity.mjs')],
  { env: process.env, encoding: 'utf8' }
).trim()).canonicalId as string;

test.beforeAll(() => {
  assertCredentialedE2EEnvironment(credentialedEnvironment);
});

async function precompileAdminRoutes(request: APIRequestContext, paths: string[]) {
  for (const path of paths) {
    const response = await request.get(path);
    await response.body();
  }
}

function activeTableRow(page: Page, name: string, status = '使用中') {
  return page.getByRole('row').filter({ hasText: name }).filter({ hasText: status });
}

type CreatedFixture = {
  prefix: string;
  studentName: string;
  guardianName: string;
  campusName: string;
  courseName: string;
  cohortName: string;
  feePlanName: string;
  enrollmentStudentName: string;
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

function macauLaterTodayInput(offsetMinutes: number) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Macau', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  });
  const parts = formatter.formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(item => item.type === type)?.value ?? 0);
  const futureMinutes = Math.min(value('hour') * 60 + value('minute') + offsetMinutes, 23 * 60 + 59);
  return `${value('year')}-${String(value('month')).padStart(2, '0')}-${String(value('day')).padStart(2, '0')}T${String(Math.floor(futureMinutes / 60)).padStart(2, '0')}:${String(futureMinutes % 60).padStart(2, '0')}`;
}

async function cleanupAdminUxFixture(client: SupabaseClient, fixture: CreatedFixture) {
  let studentsQuery = client.from('students').select('id,organization_id').in('display_name', [fixture.studentName, fixture.enrollmentStudentName]);
  if (organizationId) studentsQuery = studentsQuery.eq('organization_id', organizationId);
  const { data: students, error: studentError } = await studentsQuery;
  if (studentError) throw studentError;
  const studentIds = (students ?? []).map((student) => student.id);
  if (!studentIds.length) {
    if (!organizationId) return;
    const { data: cohorts, error: cohortError } = await client.from('exam_cohorts').select('id').eq('organization_id', organizationId).like('name', `${fixture.prefix}%`);
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
      let update = client.from(table).update({ is_active: false }).eq('organization_id', organizationId);
      update = table === 'courses' ? update.like(column, `${fixture.prefix}%`) : update.eq(column, value);
      const { error } = await update;
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

    const { data: cohorts, error: cohortLookupError } = await client.from('exam_cohorts').select('id').eq('organization_id', organizationId).like('name', `${fixture.prefix}%`);
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
    const { error: courseUpdateError } = await client.from('courses').update({ is_active: false }).eq('organization_id', organizationId).like('title', `${fixture.prefix}%`);
    if (courseUpdateError) throw courseUpdateError;
    const { error: campusUpdateError } = await client.from('campuses').update({ is_active: false }).eq('organization_id', organizationId).eq('name', fixture.campusName);
    if (campusUpdateError) throw campusUpdateError;
  }
}

test.describe('教育中心營運主流程', () => {
  test.skip(!email || !password || !supabaseUrl || !anonKey || !serviceRoleKey || !organizationId || !parentEmail || !parentPassword, '需要 seed 管理員、家長、Supabase keys 及本機 E2E 環境');
  let fixture: CreatedFixture | null = null;

  test.afterEach(async () => {
    if (!fixture || !supabaseUrl || !serviceRoleKey) return;
    const client = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    await cleanupAdminUxFixture(client, fixture);
    fixture = null;
  });

  test('招生、報讀、收費、點名、扣堂、請假、補課及跟進', async ({ page, request }, testInfo) => {
    const fixtureScope = `${canonicalRunId}-${testInfo.project.name}-${testInfo.retry}`
      .replace(/[^a-z0-9_-]/gi, '_');
    const prefix = `TEST_ADMIN_UX_${fixtureScope}`;
    const studentName = `${prefix}_STUDENT`;
    const guardianName = `${prefix}_PARENT`;
    const campusName = `${prefix}_CAMPUS`;
    const courseName = `${prefix}_COURSE`;
    const cohortName = `${prefix}_COHORT`;
    const feePlanName = `${prefix}_PACKAGE`;
    const enrollmentStudentName = `${prefix}_ENROLLMENT_STUDENT`;
    fixture = { prefix, studentName, guardianName, campusName, courseName, cohortName, feePlanName, enrollmentStudentName };
    test.setTimeout(180_000);
    const adminClient = createClient(supabaseUrl!, serviceRoleKey!, { auth: { persistSession: false, autoRefreshToken: false } });
    const assertPersisted = async (table: string, filters: Record<string, string>) => {
      let query = adminClient.from(table).select('id').eq('organization_id', organizationId!);
      for (const [key, value] of Object.entries(filters)) query = query.eq(key, value);
      const { data, error } = await query;
      expect(error).toBeNull();
      expect(data?.length ?? 0).toBeGreaterThan(0);
    };

    await precompileAdminRoutes(request, [
      '/admin/dashboard',
      '/admin/settings',
      '/admin/courses',
      '/admin/packages',
      '/admin/exam-cohorts',
      '/admin/exam-cohorts/00000000-0000-4000-8000-000000000000',
      '/admin/exam-cohorts/00000000-0000-4000-8000-000000000000/lesson-plans',
      '/admin/exam-cohorts/00000000-0000-4000-8000-000000000000/lesson-sessions',
      '/admin/students',
      '/admin/payments',
      '/admin/guardians',
      '/admin/attendance',
      '/admin/leave-makeup',
      '/admin/makeup',
      '/admin/makeup/00000000-0000-4000-8000-000000000000',
      '/admin/follow-ups'
    ]);
    await page.goto('/login');
    await page.getByLabel('電郵').fill(email!);
    await page.getByLabel('密碼').fill(password!);
    await page.getByRole('button', { name: '登入' }).click();
    await expect(page).toHaveURL(/\/admin\/dashboard$/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { name: '營運儀表板' })).toBeVisible();

    await page.goto('/admin/settings');
    await page.getByLabel('校區名稱').fill(campusName);
    await page.getByLabel('校區地址').fill('澳門測試地址');
    await page.getByRole('button', { name: '建立校區' }).click();
    await expect(page.getByRole('status')).toContainText('校區已建立');
    await page.reload();
    await expect(activeTableRow(page, campusName)).toHaveCount(1);

    await page.goto('/admin/courses');
    await page.getByLabel('課程名稱').fill(courseName);
    await page.getByLabel('類別').fill('Python');
    await page.getByLabel('程度').fill('測試');
    await page.getByLabel('校區').selectOption({ label: campusName });
    await page.getByRole('button', { name: '新增課程' }).click();
    await expect(page.getByRole('status')).toContainText('課程已新增');
    await page.reload();
    await expect(activeTableRow(page, courseName, '啟用')).toHaveCount(1);

    await page.goto('/admin/packages');
    await page.getByLabel('套票名稱').fill(feePlanName);
    await page.getByLabel('適用課程').selectOption({ label: courseName });
    await page.getByLabel('堂數').fill('8');
    await page.getByLabel('金額（仙）').fill('120000');
    await page.getByRole('button', { name: '建立套票' }).click();
    await expect(page.getByRole('status')).toContainText('套票已建立');
    await page.reload();
    await expect(activeTableRow(page, feePlanName)).toHaveCount(1);

    await page.goto('/admin/exam-cohorts');
    const courseOption = page.getByLabel('所屬課程').locator('option').filter({ hasText: courseName });
    await page.getByLabel('所屬課程').selectOption((await courseOption.getAttribute('value'))!);
    await page.getByLabel('班別名稱').fill(cohortName);
    await page.getByLabel('考試日期').fill(macauDateInput(90));
    await page.getByLabel('上課日').selectOption('saturday');
    await page.getByLabel('導師').selectOption({ index: 1 });
    await page.getByLabel('校區').last().selectOption({ label: campusName });
    await page.getByLabel('班別狀態').selectOption('active');
    await page.getByRole('button', { name: '建立班別' }).click();
    await expect(page.getByRole('status')).toContainText('班別已建立');
    await page.reload();
    await assertPersisted('campuses', { name: campusName });
    await assertPersisted('courses', { title: courseName });
    await assertPersisted('fee_plans', { name: feePlanName });
    await assertPersisted('exam_cohorts', { name: cohortName });
    const cohortRow = activeTableRow(page, cohortName);
    const cohortHref = await cohortRow.getByRole('link', { name: '開啟班別' }).getAttribute('href');
    expect(cohortHref).toBeTruthy();

    await page.goto(`${cohortHref}/lesson-plans`);
    await page.getByLabel('第 1 堂教學內容').fill('測試教學內容');
    await page.getByRole('button', { name: '儲存教案' }).click();
    await expect(page.getByRole('status')).toContainText('教案已儲存', { timeout: 15_000 });

    await page.goto(`${cohortHref}/lesson-sessions`);
    await page.getByLabel('教案').selectOption({ index: 1 });
    await page.getByLabel('導師').selectOption({ index: 1 });
    await page.getByLabel('開始時間').fill(macauLaterTodayInput(30));
    await page.getByLabel('結束時間').fill(macauLaterTodayInput(90));
    await page.getByRole('button', { name: '建立未來課堂' }).click();
    await expect(page.getByText('未來課堂已建立')).toBeVisible();
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await page.getByLabel('教案').selectOption({ index: 2 });
    await page.getByLabel('導師').selectOption({ index: 1 });
    await page.getByLabel('開始時間').fill(macauDateInput(2, '09:00'));
    await page.getByLabel('結束時間').fill(macauDateInput(2, '10:00'));
    await page.getByRole('button', { name: '建立未來課堂' }).click();
    await expect(page.locator('tbody tr')).toHaveCount(2, { timeout: 15_000 });
    const persistedCohort = await adminClient.from('exam_cohorts').select('id').eq('organization_id', organizationId!).eq('name', cohortName).single();
    expect(persistedCohort.error).toBeNull();
    const persistedPlans = await adminClient.from('lesson_plans').select('id').eq('organization_id', organizationId!).eq('cohort_id', persistedCohort.data!.id);
    expect(persistedPlans.error).toBeNull();
    expect(persistedPlans.data?.length ?? 0).toBeGreaterThan(0);
    const persistedSessions = await adminClient.from('lesson_sessions').select('id').eq('organization_id', organizationId!).eq('cohort_id', persistedCohort.data!.id);
    expect(persistedSessions.error).toBeNull();
    expect(persistedSessions.data?.length ?? 0).toBe(2);

    const standaloneStudent = await adminClient.from('students').insert({
      organization_id: organizationId!,
      display_name: enrollmentStudentName,
      school_name: '澳門合成測試學校',
      status: 'active'
    }).select('id').single();
    expect(standaloneStudent.error).toBeNull();
    await page.goto(cohortHref!);
    await page.getByLabel('要加入的學生').selectOption({ label: enrollmentStudentName });
    await page.getByRole('button', { name: '加入班別' }).click();
    await expect(page.getByRole('status')).toContainText('學生已加入班別');
    await expect(page.getByLabel('要加入的學生').locator('option').filter({ hasText: enrollmentStudentName })).toHaveCount(0);
    await page.reload();
    await expect(page.getByText(enrollmentStudentName)).toBeVisible();

    const adminSessionClient = createClient(supabaseUrl!, anonKey!, { auth: { persistSession: false, autoRefreshToken: false } });
    const adminSignIn = await adminSessionClient.auth.signInWithPassword({ email: email!, password: password! });
    expect(adminSignIn.error).toBeNull();
    const duplicateEnrollment = await adminSessionClient.rpc('enroll_student_in_cohort', {
      target_organization_id: organizationId!,
      target_cohort_id: persistedCohort.data!.id,
      target_student_id: standaloneStudent.data!.id
    });
    expect(duplicateEnrollment.error).toBeNull();
    expect((duplicateEnrollment.data as { status: string }).status).toBe('existing');

    const withdrawEnrollment = await adminClient.from('cohort_students').update({ status: 'withdrawn', left_at: new Date().toISOString().slice(0, 10) })
      .eq('organization_id', organizationId!).eq('cohort_id', persistedCohort.data!.id).eq('student_id', standaloneStudent.data!.id);
    expect(withdrawEnrollment.error).toBeNull();
    await page.reload();
    await page.getByLabel('要加入的學生').selectOption({ label: enrollmentStudentName });
    await page.getByRole('button', { name: '加入班別' }).click();
    await expect(page.getByRole('status')).toContainText('舊報讀記錄已恢復');
    await expect(page.getByLabel('要加入的學生').locator('option').filter({ hasText: enrollmentStudentName })).toHaveCount(0);
    await page.reload();
    await expect(page.getByText(enrollmentStudentName)).toBeVisible();

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

    await page.goto('/admin/guardians');
    const existingParentCard = page.locator('article').filter({ hasText: 'Guardian A' });
    await existingParentCard.getByLabel('連結另一名學生').selectOption({ label: enrollmentStudentName });
    await existingParentCard.getByRole('button', { name: '連結學生' }).click();
    await expect(existingParentCard.getByRole('status')).toContainText('已連結至現有家長帳戶');

    const parentClient = createClient(supabaseUrl!, anonKey!, { auth: { persistSession: false, autoRefreshToken: false } });
    const parentSignIn = await parentClient.auth.signInWithPassword({ email: parentEmail!, password: parentPassword! });
    expect(parentSignIn.error).toBeNull();
    const parentStudents = await parentClient.rpc('get_parent_attendance_summary');
    expect(parentStudents.error).toBeNull();
    const parentStudentIds = (parentStudents.data ?? []).map((row: { student_id: string }) => row.student_id);
    expect(parentStudentIds).toContain('15000000-0000-4000-8000-000000000001');
    expect(parentStudentIds).toContain(standaloneStudent.data!.id);
    const parentFutureLessons = await parentClient.rpc('get_parent_lesson_sessions', { p_student_id: standaloneStudent.data!.id });
    expect(parentFutureLessons.error).toBeNull();
    expect(parentFutureLessons.data?.length ?? 0).toBe(2);

    page.once('dialog', dialog => dialog.accept());
    await existingParentCard.getByText(enrollmentStudentName).locator('..').getByRole('button', { name: '移除連結' }).click();
    await expect(existingParentCard.getByTestId('linked-students-13000000-0000-4000-8000-000000000001').getByText(enrollmentStudentName)).toHaveCount(0);
    const activeParent = await adminClient.from('parent_profiles').select('account_status').eq('id', '13000000-0000-4000-8000-000000000001').single();
    expect(activeParent.data?.account_status).toBe('active');
    const unlinkAudit = await adminClient.from('audit_logs').select('id').eq('organization_id', organizationId!).eq('table_name', 'parent_student_links').eq('action', 'DELETE').contains('old_data', { student_id: standaloneStudent.data!.id });
    expect(unlinkAudit.error).toBeNull();
    expect(unlinkAudit.data?.length ?? 0).toBeGreaterThan(0);
    const retireStandaloneEnrollment = await adminClient.from('cohort_students').update({ status: 'withdrawn', left_at: new Date().toISOString().slice(0, 10) })
      .eq('organization_id', organizationId!).eq('cohort_id', persistedCohort.data!.id).eq('student_id', standaloneStudent.data!.id);
    expect(retireStandaloneEnrollment.error).toBeNull();

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
    await expect(page.getByRole('status')).toContainText('請假申請已建立。', { timeout: 30_000 });
    const leaveRow = page.getByRole('row').filter({ hasText: studentName }).filter({ hasText: '家庭安排' });
    await expect(leaveRow).toBeVisible({ timeout: 30_000 });
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

  test('核心營運頁不會顯示內部錯誤或元件名稱', async ({ page, request }) => {
    await precompileAdminRoutes(request, [
      '/admin/dashboard', '/admin/students', '/admin/courses', '/admin/exam-cohorts',
      '/admin/leave-makeup', '/admin/makeup'
    ]);
    await page.goto('/login');
    await page.getByLabel('電郵').fill(email!);
    await page.getByLabel('密碼').fill(password!);
    await page.getByRole('button', { name: '登入' }).click();
    await expect(page).toHaveURL(/\/admin\/dashboard$/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { name: '營運儀表板' })).toBeVisible();

    for (const path of ['/admin/students', '/admin/courses', '/admin/exam-cohorts', '/admin/leave-makeup', '/admin/makeup']) {
      await page.goto(path);
      const body = await page.locator('body').innerText();
      expect(body).not.toMatch(/row-level security policy|permission denied|PGRST|LessonPlanEditor|LessonSessionsPage|MakeupStudentListPage|error code/i);
    }
  });

  test('同一學生可跨課程報讀，並須透過確認流程在同課程轉班', async ({ page, request }, testInfo) => {
    test.setTimeout(300_000);
    const scope = `${canonicalRunId}-${testInfo.project.name}-${testInfo.retry}`.replace(/[^a-z0-9_-]/gi, '_');
    const prefix = `TEST_COURSE_MODEL_${scope}`;
    const pythonCourse = `${prefix}_PYTHON`;
    const scratchCourse = `${prefix}_SCRATCH`;
    const pythonA = `${prefix}_PYTHON_A`;
    const pythonB = `${prefix}_PYTHON_B`;
    const scratchA = `${prefix}_SCRATCH_A`;
    const studentName = `${prefix}_STUDENT`;
    fixture = {
      prefix, studentName, enrollmentStudentName: studentName, guardianName: `${prefix}_UNUSED_PARENT`,
      campusName: `${prefix}_UNUSED_CAMPUS`, courseName: pythonCourse, cohortName: pythonA,
      feePlanName: `${prefix}_UNUSED_PACKAGE`
    };
    const adminClient = createClient(supabaseUrl!, serviceRoleKey!, { auth: { persistSession: false, autoRefreshToken: false } });

    await precompileAdminRoutes(request, [
      '/admin/dashboard', '/admin/courses', '/admin/exam-cohorts',
      '/admin/exam-cohorts/00000000-0000-4000-8000-000000000000'
    ]);
    await page.goto('/login');
    await page.getByLabel('電郵').fill(email!);
    await page.getByLabel('密碼').fill(password!);
    await page.getByRole('button', { name: '登入' }).click();
    await expect(page).toHaveURL(/\/admin\/dashboard$/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { name: '營運儀表板' })).toBeVisible();

    await page.goto('/admin/courses');
    const createCourse = async (title: string, category: string, level: string) => {
      await page.getByLabel('課程名稱').fill(title);
      await page.getByLabel('類別').fill(category);
      await page.getByLabel('程度').fill(level);
      await page.getByRole('button', { name: '新增課程' }).click();
      await expect(page.getByRole('status')).toContainText('課程已新增', { timeout: 15_000 });
      await expect(activeTableRow(page, title, '啟用')).toHaveCount(1);
    };
    await createCourse(pythonCourse, 'Python', '三級');
    await createCourse(scratchCourse, 'Scratch', '一級');
    await expect(activeTableRow(page, pythonCourse, '啟用')).toHaveCount(1);
    await expect(activeTableRow(page, scratchCourse, '啟用')).toHaveCount(1);

    const createCohort = async (courseTitle: string, cohortName: string, weekday: 'saturday' | 'sunday') => {
      await page.goto('/admin/exam-cohorts');
      const option = page.getByLabel('所屬課程').locator('option').filter({ hasText: courseTitle });
      await page.getByLabel('所屬課程').selectOption((await option.getAttribute('value'))!);
      await page.getByLabel('班別名稱').fill(cohortName);
      await page.getByLabel('考試日期').fill(macauDateInput(100));
      await page.getByLabel('上課日').selectOption(weekday);
      await page.getByLabel('班別狀態').selectOption('active');
      await page.getByRole('button', { name: '建立班別' }).click();
      await expect(page.getByRole('status')).toContainText('班別已建立', { timeout: 15_000 });
      await expect(activeTableRow(page, cohortName)).toHaveCount(1);
    };
    await createCohort(pythonCourse, pythonA, 'saturday');
    await createCohort(pythonCourse, pythonB, 'sunday');
    await createCohort(scratchCourse, scratchA, 'saturday');

    const student = await adminClient.from('students').insert({ organization_id: organizationId!, display_name: studentName, status: 'active' }).select('id').single();
    expect(student.error).toBeNull();
    const cohorts = await adminClient.from('exam_cohorts').select('id,name,course_id').eq('organization_id', organizationId!).in('name', [pythonA, pythonB, scratchA]);
    expect(cohorts.error).toBeNull();
    const cohort = (name: string) => cohorts.data!.find(row => row.name === name)!;

    const openCohort = async (name: string) => {
      await page.goto('/admin/exam-cohorts');
      const href = await page.getByRole('row').filter({ hasText: name }).getByRole('link', { name: '開啟班別' }).getAttribute('href');
      await page.goto(href!);
    };
    await openCohort(pythonA);
    await page.getByLabel('要加入的學生').selectOption({ label: studentName });
    await page.getByRole('button', { name: '加入班別' }).click();
    await expect(page.getByRole('status')).toContainText('學生已加入班別。', { timeout: 15_000 });
    await expect(page.getByLabel('要加入的學生').locator('option').filter({ hasText: studentName })).toHaveCount(0);

    await openCohort(scratchA);
    await page.getByLabel('要加入的學生').selectOption({ label: studentName });
    await page.getByRole('button', { name: '加入班別' }).click();
    await expect(page.getByRole('status')).toContainText('學生已加入班別。', { timeout: 15_000 });
    await expect(page.getByLabel('要加入的學生').locator('option').filter({ hasText: studentName })).toHaveCount(0);

    const sessionClient = createClient(supabaseUrl!, anonKey!, { auth: { persistSession: false, autoRefreshToken: false } });
    expect((await sessionClient.auth.signInWithPassword({ email: email!, password: password! })).error).toBeNull();
    const replay = await sessionClient.rpc('enroll_student_in_cohort', { target_organization_id: organizationId!, target_cohort_id: cohort(pythonA).id, target_student_id: student.data!.id });
    expect(replay.error).toBeNull();
    expect((replay.data as { status: string }).status).toBe('existing');

    await openCohort(pythonB);
    await page.getByLabel('要加入的學生').selectOption({ label: studentName });
    await page.getByRole('button', { name: '加入班別' }).click();
    await expect(page.getByRole('status')).toContainText('學生已報讀此課程的另一班別。如需更換，請使用轉班。', { timeout: 15_000 });
    await expect(page.locator('body')).not.toContainText(/duplicate key|unique_active_exam_membership|PGRST|error boundary/i);

    await openCohort(pythonA);
    const transfer = page.locator('form').filter({ hasText: `學生：${studentName}` });
    await transfer.getByLabel(`為${studentName}選擇目標班別`).selectOption({ label: pythonB });
    await transfer.getByRole('checkbox').check();
    await transfer.getByRole('button', { name: '確認轉班' }).click();
    await expect(transfer.getByRole('status')).toContainText('學生已完成轉班，舊報讀記錄已保留。', { timeout: 15_000 });
    await page.reload();

    const memberships = await adminClient.from('cohort_students').select('cohort_id,status,is_active_membership,left_at').eq('organization_id', organizationId!).eq('student_id', student.data!.id);
    expect(memberships.error).toBeNull();
    expect(memberships.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ cohort_id: cohort(pythonA).id, status: 'withdrawn', is_active_membership: false }),
      expect.objectContaining({ cohort_id: cohort(pythonB).id, status: 'active', is_active_membership: true }),
      expect.objectContaining({ cohort_id: cohort(scratchA).id, status: 'active', is_active_membership: true })
    ]));
    await openCohort(pythonB);
    await expect(page.getByText(studentName).first()).toBeVisible();
  });
});

test('Teacher direct URL and navigation cannot reach the operations dashboard', async ({ page, request }, testInfo) => {
  test.skip(!teacherEmail || !teacherPassword, '需要本機 Teacher 測試登入');
  await precompileAdminRoutes(request, ['/admin/attendance', '/admin/dashboard', '/admin']);
  await page.goto('/login');
  await page.getByLabel('電郵').fill(teacherEmail!);
  await page.getByLabel('密碼').fill(teacherPassword!);
  await page.getByRole('button', { name: '登入' }).click();
  await expect(page).toHaveURL(/\/admin\/attendance$/, { timeout: 30_000 });
  if (testInfo.project.name === 'teacher-mobile') await page.locator('summary').click();
  const navigation = page.getByRole('navigation', { name: '後台功能' });
  await expect(navigation.getByRole('link', { name: '總覽' })).toHaveCount(0);
  await expect(navigation.getByRole('link', { name: '課堂與點名' })).toHaveCount(1);
  await expect(navigation.getByRole('link', { name: '今日課堂' })).toHaveCount(0);
  await page.goto('/admin/dashboard');
  await expect(page).toHaveURL(/\/admin\/attendance$/);
  await expect(page.locator('body')).not.toContainText(/欠費總額|本月收款|營運儀表板/);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/attendance$/);
});

async function signInTeacher(page: Page) {
  await page.goto('/login');
  await page.getByLabel('電郵').fill(teacherEmail!);
  await page.getByLabel('密碼').fill(teacherPassword!);
  await page.getByRole('button', { name: '登入' }).click();
  await expect(page).toHaveURL(/\/admin\/attendance$/, { timeout: 30_000 });
}

test('Teacher stale attendance page is rejected and refresh receives the new revision', async ({ browser, request }, testInfo) => {
  test.setTimeout(180_000);
  test.skip(
    !teacherEmail || !teacherPassword || !supabaseUrl || !serviceRoleKey || !organizationId,
    '需要本機 Teacher 測試登入及 Supabase fixture 管理環境'
  );

  const fixtureClient = createClient(supabaseUrl!, serviceRoleKey!, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  await precompileAdminRoutes(request, ['/admin/attendance']);
  const sessionId = crypto.randomUUID();
  const studentId = '15000000-0000-4000-8000-000000000001';
  const requestPrefix = `teacher-stale-${canonicalRunId}-${testInfo.project.name}`;
  const requestA = `${requestPrefix}-a`;
  const requestB = `${requestPrefix}-b`;
  const requestRefresh = `${requestPrefix}-refresh`;
  const startsAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const endsAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const countRows = async (table: 'notifications' | 'notification_outbox') => {
    const result = await fixtureClient.from(table).select('id', { count: 'exact', head: true });
    expect(result.error).toBeNull();
    return result.count ?? 0;
  };
  const notificationCount = await countRows('notifications');
  const outboxCount = await countRows('notification_outbox');

  const sessionInsert = await fixtureClient.from('lesson_sessions').insert({
    id: sessionId,
    organization_id: organizationId!,
    cohort_id: '1a000000-0000-4000-8000-000000000001',
    lesson_plan_id: '1c000000-0000-4000-8000-000000000001',
    teacher_id: '19000000-0000-4000-8000-000000000001',
    starts_at: startsAt,
    ends_at: endsAt,
    status: 'completed'
  });
  expect(sessionInsert.error).toBeNull();
  const attendanceInsert = await fixtureClient.from('attendance_records').insert({
    organization_id: organizationId!,
    session_id: sessionId,
    student_id: studentId,
    status: 'present',
    recorded_at: endsAt
  }).select('id,revision').single();
  expect(attendanceInsert.error).toBeNull();
  expect(attendanceInsert.data?.revision).toBe(1);

  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const formFor = (page: Page) => page.locator(
    `form:has(input[name="session_id"][value="${sessionId}"]):has(input[name="student_id"][value="${studentId}"])`
  );

  try {
    await Promise.all([signInTeacher(pageA), signInTeacher(pageB)]);
    await Promise.all([
      pageA.goto('/admin/attendance?range=all'),
      pageB.goto('/admin/attendance?range=all')
    ]);
    const formA = formFor(pageA);
    const formB = formFor(pageB);
    await expect(formA).toHaveCount(1);
    await expect(formB).toHaveCount(1);
    await expect(formA.locator('input[name="expected_revision"]')).toHaveValue('1');
    await expect(formB.locator('input[name="expected_revision"]')).toHaveValue('1');

    await formA.locator('input[name="reason"]').fill('Playwright T8 A');
    await formA.locator('input[name="request_id"]').evaluate((element, requestId) => {
      (element as HTMLInputElement).value = requestId;
    }, requestA);
    await formA.getByText('缺席', { exact: true }).click();
    await expect(formA.getByRole('radio', { name: '缺席' })).toBeChecked();
    await formA.getByRole('button', { name: '更新點名' }).click();
    await expect.poll(async () => {
      const result = await fixtureClient.from('attendance_records')
        .select('status,revision').eq('session_id', sessionId).eq('student_id', studentId).single();
      return result.error ? `error:${result.error.code}` : `${result.data.status}:${result.data.revision}`;
    }, { timeout: 30_000 }).toBe('absent:2');

    await formB.locator('input[name="reason"]').fill('Playwright T8 B stale');
    await formB.locator('input[name="request_id"]').evaluate((element, requestId) => {
      (element as HTMLInputElement).value = requestId;
    }, requestB);
    await formB.getByText('請假', { exact: true }).click();
    await expect(formB.getByRole('radio', { name: '請假' })).toBeChecked();
    await formB.getByRole('button', { name: '更新點名' }).click();
    await expect(formFor(pageB).getByRole('status')).toContainText('此點名已被其他操作更新，請重新載入後再提交。', { timeout: 30_000 });
    await expect(pageB.locator('body')).not.toContainText(/PGRST|SQLSTATE|uuid|token|@|UserFacingOperationError|stack trace/i);

    const afterConflict = await fixtureClient.from('attendance_records')
      .select('status,revision').eq('session_id', sessionId).eq('student_id', studentId).single();
    expect(afterConflict.error).toBeNull();
    expect(afterConflict.data).toMatchObject({ status: 'absent', revision: 2 });
    const auditA = await fixtureClient.from('audit_logs').select('id', { count: 'exact', head: true })
      .contains('new_data', { attendance_history: { request_id: requestA } });
    const auditB = await fixtureClient.from('audit_logs').select('id', { count: 'exact', head: true })
      .contains('new_data', { attendance_history: { request_id: requestB } });
    expect(auditA.error).toBeNull();
    expect(auditB.error).toBeNull();
    expect(auditA.count).toBe(1);
    expect(auditB.count).toBe(0);
    expect(await countRows('notifications')).toBe(notificationCount);
    expect(await countRows('notification_outbox')).toBe(outboxCount);

    await pageB.reload();
    const refreshedForm = formFor(pageB);
    await expect(refreshedForm.locator('input[name="expected_revision"]')).toHaveValue('2');
    await expect(refreshedForm.getByRole('radio', { name: '缺席' })).toBeChecked();
    await refreshedForm.locator('input[name="reason"]').fill('Playwright T8 refreshed');
    await refreshedForm.locator('input[name="request_id"]').evaluate((element, requestId) => {
      (element as HTMLInputElement).value = requestId;
    }, requestRefresh);
    await refreshedForm.getByText('出席', { exact: true }).click();
    await expect(refreshedForm.getByRole('radio', { name: '出席' })).toBeChecked();
    await refreshedForm.getByRole('button', { name: '更新點名' }).click();
    await expect.poll(async () => {
      const result = await fixtureClient.from('attendance_records')
        .select('status,revision').eq('session_id', sessionId).eq('student_id', studentId).single();
      return result.error ? `error:${result.error.code}` : `${result.data.status}:${result.data.revision}`;
    }, { timeout: 30_000 }).toBe('present:3');
    const afterRefresh = await fixtureClient.from('attendance_records')
      .select('status,revision').eq('session_id', sessionId).eq('student_id', studentId).single();
    expect(afterRefresh.error).toBeNull();
    expect(afterRefresh.data).toMatchObject({ status: 'present', revision: 3 });
  } finally {
    await Promise.allSettled([contextA.close(), contextB.close()]);
    const attendance = await fixtureClient.from('attendance_records')
      .select('id').eq('session_id', sessionId).eq('student_id', studentId).maybeSingle();
    if (attendance.data?.id) {
      await fixtureClient.from('attendance_records').delete().eq('id', attendance.data.id);
      await fixtureClient.from('audit_logs').delete().eq('record_id', attendance.data.id);
    }
    await fixtureClient.from('lesson_sessions').delete().eq('id', sessionId);
  }
});
