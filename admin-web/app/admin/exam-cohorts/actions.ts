'use server';

import { revalidatePath } from 'next/cache';
import { getOperationsContext } from '@/lib/operations/context';
import { safeOperationMessage, UserFacingOperationError, userFacingError } from '@/lib/operations/errors';

export type ExamCohortFormState = {
  status: 'idle' | 'success' | 'error';
  message?: string;
};

async function requireManager() {
  const context = await getOperationsContext();
  if (!['admin', 'staff'].includes(context.role)) throw userFacingError('只有管理員或職員可以管理班別。');
  return context;
}

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? '').trim();
}

function nullableText(formData: FormData, key: string) {
  const value = text(formData, key);
  return value || null;
}

function macauDateTimeLocalToIso(value: string) {
  if (!value) return null;
  const normalized = value.length === 16 ? `${value}:00+08:00` : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : normalized;
}

export async function createExamCohortAction(
  _prevState: ExamCohortFormState,
  formData: FormData
): Promise<ExamCohortFormState> {
  const name = text(formData, 'name');
  const subject = text(formData, 'subject');
  const level = text(formData, 'level');
  const examDate = text(formData, 'exam_date');
  const weekdayPattern = text(formData, 'weekday_pattern');
  const leadTeacherId = nullableText(formData, 'lead_teacher_id');
  const status = text(formData, 'status') || 'draft';

  if (!name || !subject || !level || !examDate || !weekdayPattern) return { status: 'error', message: '請填寫班別名稱、科目、程度、考試日期及上課日。' };
  if (!['draft', 'active'].includes(status)) return { status: 'error', message: '班別狀態無效。' };

  try {
    const context = await requireManager();
    if (leadTeacherId) {
      const { data: teacher, error: teacherError } = await context.supabase.from('teacher_profiles').select('id').eq('id', leadTeacherId).eq('organization_id', context.organizationId).eq('is_active', true).maybeSingle();
      if (teacherError || !teacher) throw teacherError ?? userFacingError('所選導師已不存在或不屬於目前機構，請重新選擇。');
    }

    const { error } = await context.supabase.from('exam_cohorts').insert({
      organization_id: context.organizationId,
      name,
      subject,
      level,
      exam_date: examDate,
      weekday_pattern: weekdayPattern,
      lead_teacher_id: leadTeacherId,
      status
    });
    if (error) throw error;

    revalidatePath('/admin/exam-cohorts');
    revalidatePath('/admin/classes');
    revalidatePath('/admin/dashboard');
    return { status: 'success', message: '班別已建立。' };
  } catch (error) {
    return { status: 'error', message: error instanceof UserFacingOperationError ? error.message : safeOperationMessage(error, '建立班別失敗，請稍後再試。', 'create-cohort') };
  }
}

export async function addCohortStudentAction(
  cohortId: string,
  _prevState: ExamCohortFormState,
  formData: FormData
): Promise<ExamCohortFormState> {
  const studentId = text(formData, 'student_id');
  if (!studentId) return { status: 'error', message: '請選擇要加入的學生。' };

  try {
    const context = await requireManager();
    const [{ data: cohort, error: cohortError }, { data: student, error: studentError }] = await Promise.all([
      context.supabase.from('exam_cohorts').select('id').eq('id', cohortId).eq('organization_id', context.organizationId).maybeSingle(),
      context.supabase.from('students').select('id').eq('id', studentId).eq('organization_id', context.organizationId).eq('status', 'active').maybeSingle()
    ]);
    if (cohortError || studentError) throw cohortError ?? studentError;
    if (!cohort || !student) throw userFacingError('所選班別或學生已不存在，或不屬於目前機構，請重新選擇。');

    const { data, error } = await context.supabase.rpc('enroll_student_in_cohort', {
      target_organization_id: context.organizationId,
      target_cohort_id: cohortId,
      target_student_id: studentId
    });
    if (error) throw error;

    revalidatePath('/admin/exam-cohorts');
    revalidatePath(`/admin/exam-cohorts/${cohortId}`);
    revalidatePath('/admin/classes');
    revalidatePath('/admin/students');
    revalidatePath('/admin/sessions');
    revalidatePath('/admin/attendance');
    revalidatePath('/admin/dashboard');
    const result = data as { status?: string } | null;
    const message = result?.status === 'reactivated'
      ? '學生的舊報讀記錄已恢復，現已重新加入班別。'
      : result?.status === 'existing'
        ? '學生已在此班別，現有報讀記錄保持有效。'
        : '學生已加入班別。';
    return { status: 'success', message };
  } catch (error) {
    return { status: 'error', message: error instanceof UserFacingOperationError ? error.message : safeOperationMessage(error, '加入學生失敗，請稍後再試。', 'add-cohort-student') };
  }
}

export async function saveLessonPlanAction(
  cohortId: string,
  _prevState: ExamCohortFormState,
  formData: FormData
): Promise<ExamCohortFormState> {
  const rows = Array.from({ length: 12 }, (_, index) => {
    const sequenceNo = index + 1;
    return {
      cohort_id: cohortId,
      sequence_no: sequenceNo,
      title: text(formData, `title_${sequenceNo}`) || `第 ${sequenceNo} 堂`,
      teaching_content: nullableText(formData, `teaching_content_${sequenceNo}`),
      makeup_guidance: nullableText(formData, `makeup_guidance_${sequenceNo}`)
    };
  });

  try {
    const context = await requireManager();
    const { data: cohort, error: cohortError } = await context.supabase.from('exam_cohorts').select('id').eq('id', cohortId).eq('organization_id', context.organizationId).maybeSingle();
    if (cohortError || !cohort) throw cohortError ?? userFacingError('班別已不存在或不屬於目前機構。');

    const { error } = await context.supabase.from('lesson_plans').upsert(
      rows.map(row => ({ ...row, organization_id: context.organizationId })),
      { onConflict: 'cohort_id,sequence_no' }
    );
    if (error) throw error;

    revalidatePath(`/admin/exam-cohorts/${cohortId}`);
    revalidatePath(`/admin/exam-cohorts/${cohortId}/lesson-plans`);
    return { status: 'success', message: '教案已儲存。' };
  } catch (error) {
    return { status: 'error', message: error instanceof UserFacingOperationError ? error.message : safeOperationMessage(error, '儲存教案失敗，請稍後再試。', 'save-lesson-plan') };
  }
}

export async function createLessonSessionAction(
  cohortId: string,
  _prevState: ExamCohortFormState,
  formData: FormData
): Promise<ExamCohortFormState> {
  const lessonPlanId = text(formData, 'lesson_plan_id');
  const teacherId = text(formData, 'teacher_id');
  const startsAt = macauDateTimeLocalToIso(text(formData, 'starts_at'));
  const endsAt = macauDateTimeLocalToIso(text(formData, 'ends_at'));
  const status = text(formData, 'status') || 'scheduled';

  if (!lessonPlanId || !teacherId || !startsAt || !endsAt) return { status: 'error', message: '請選擇教案、導師及填寫開始與結束時間。' };
  if (!['scheduled', 'completed', 'cancelled'].includes(status)) return { status: 'error', message: '課堂狀態無效。' };
  if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) return { status: 'error', message: '結束時間必須晚於開始時間。' };

  try {
    const context = await requireManager();
    const [{ data: lessonPlan, error: lessonPlanError }, { data: teacher, error: teacherError }, { data: cohort, error: cohortError }] = await Promise.all([
      context.supabase.from('lesson_plans').select('id').eq('id', lessonPlanId).eq('cohort_id', cohortId).eq('organization_id', context.organizationId).maybeSingle(),
      context.supabase.from('teacher_profiles').select('id').eq('id', teacherId).eq('organization_id', context.organizationId).eq('is_active', true).maybeSingle(),
      context.supabase.from('exam_cohorts').select('id').eq('id', cohortId).eq('organization_id', context.organizationId).maybeSingle()
    ]);
    if (lessonPlanError || teacherError || cohortError) throw lessonPlanError ?? teacherError ?? cohortError;
    if (!cohort) throw userFacingError('班別已不存在或不屬於目前機構。');
    if (!lessonPlan) throw userFacingError('所選教案已不存在或不屬於此班別，請重新選擇。');
    if (!teacher) throw userFacingError('所選導師未啟用或不屬於目前機構，請重新選擇。');

    const { data: duplicate, error: duplicateError } = await context.supabase.from('lesson_sessions')
      .select('id')
      .eq('organization_id', context.organizationId)
      .eq('cohort_id', cohortId)
      .eq('lesson_plan_id', lessonPlanId)
      .eq('starts_at', startsAt)
      .maybeSingle();
    if (duplicateError) throw duplicateError;
    if (duplicate) throw userFacingError('相同教案及開始時間已有課堂，請勿重複建立。');

    const { error } = await context.supabase.from('lesson_sessions').insert({
      organization_id: context.organizationId,
      cohort_id: cohortId,
      lesson_plan_id: lessonPlanId,
      teacher_id: teacherId,
      starts_at: startsAt,
      ends_at: endsAt,
      status
    });
    if (error) throw error;

    revalidatePath(`/admin/exam-cohorts/${cohortId}`);
    revalidatePath(`/admin/exam-cohorts/${cohortId}/lesson-sessions`);
    revalidatePath('/admin/sessions');
    revalidatePath('/admin/dashboard');
    return { status: 'success', message: '未來課堂已建立。' };
  } catch (error) {
    return { status: 'error', message: error instanceof UserFacingOperationError ? error.message : safeOperationMessage(error, '建立課堂失敗，請稍後再試。', 'create-lesson-session') };
  }
}
