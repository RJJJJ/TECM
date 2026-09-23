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
  const courseId = text(formData, 'course_id');
  const examDate = text(formData, 'exam_date');
  const weekdayPattern = text(formData, 'weekday_pattern');
  const leadTeacherId = nullableText(formData, 'lead_teacher_id');
  const campusId = nullableText(formData, 'campus_id');
  const status = text(formData, 'status') || 'draft';

  if (!courseId) return { status: 'error', message: '請先選擇所屬課程。' };
  if (!name || !examDate || !weekdayPattern) return { status: 'error', message: '請填寫班別名稱、考試日期及上課日。' };
  if (!['draft', 'active'].includes(status)) return { status: 'error', message: '班別狀態無效。' };

  try {
    const context = await requireManager();
    const { data: course, error: courseError } = await context.supabase
      .from('courses')
      .select('id,title,category,level')
      .eq('id', courseId)
      .eq('organization_id', context.organizationId)
      .eq('is_active', true)
      .maybeSingle();
    if (courseError) throw courseError;
    if (!course || !course.category || !course.level) {
      throw userFacingError('所選課程未啟用或資料不完整，請先更新課程名稱、類別及程度。');
    }
    if (leadTeacherId) {
      const { data: teacher, error: teacherError } = await context.supabase.from('teacher_profiles').select('id').eq('id', leadTeacherId).eq('organization_id', context.organizationId).eq('is_active', true).maybeSingle();
      if (teacherError || !teacher) throw teacherError ?? userFacingError('所選導師已不存在或不屬於目前機構，請重新選擇。');
    }
    if (campusId) {
      const { data: campus, error: campusError } = await context.supabase.from('campuses').select('id').eq('id', campusId).eq('organization_id', context.organizationId).eq('is_active', true).maybeSingle();
      if (campusError || !campus) throw campusError ?? userFacingError('所選校區已不存在或未啟用，請重新選擇。');
    }

    const { error } = await context.supabase.from('exam_cohorts').insert({
      organization_id: context.organizationId,
      course_id: course.id,
      name,
      subject: course.category,
      level: course.level,
      exam_date: examDate,
      weekday_pattern: weekdayPattern,
      campus_id: campusId,
      lead_teacher_id: leadTeacherId,
      status
    });
    if (error) throw error;

    return { status: 'success', message: '班別已建立。' };
  } catch (error) {
    return { status: 'error', message: error instanceof UserFacingOperationError ? error.message : safeOperationMessage(error, '建立班別失敗，請稍後再試。', 'create-cohort') };
  }
}

export async function transferCohortStudentAction(
  sourceCohortId: string,
  studentId: string,
  _prevState: ExamCohortFormState,
  formData: FormData
): Promise<ExamCohortFormState> {
  const targetCohortId = text(formData, 'target_cohort_id');
  const confirmed = text(formData, 'confirmed') === 'true';
  if (!targetCohortId) return { status: 'error', message: '請選擇目標班別。' };
  if (!confirmed) return { status: 'error', message: '請確認轉班資料及影響後再提交。' };

  try {
    const context = await requireManager();
    const { error } = await context.supabase.rpc('transfer_student_between_cohorts', {
      target_organization_id: context.organizationId,
      target_student_id: studentId,
      source_cohort_id: sourceCohortId,
      target_cohort_id: targetCohortId,
      target_confirmed: true
    });
    if (error) throw error;
    return { status: 'success', message: '學生已完成轉班，舊報讀記錄已保留。' };
  } catch (error) {
    return { status: 'error', message: error instanceof UserFacingOperationError ? error.message : safeOperationMessage(error, '轉班失敗，請稍後再試。', 'transfer-cohort-student') };
  }
}

export async function linkCohortCourseAction(
  cohortId: string,
  _prevState: ExamCohortFormState,
  formData: FormData
): Promise<ExamCohortFormState> {
  const courseId = text(formData, 'course_id');
  const confirmed = text(formData, 'confirmed') === 'true';
  if (!courseId) return { status: 'error', message: '請選擇所屬課程。' };
  if (!confirmed) return { status: 'error', message: '請確認班別及課程資料後再連結。' };
  try {
    const context = await requireManager();
    const { error } = await context.supabase.rpc('link_cohort_to_course', {
      target_organization_id: context.organizationId,
      target_cohort_id: cohortId,
      target_course_id: courseId,
      target_confirmed: true
    });
    if (error) throw error;
    revalidatePath('/admin/exam-cohorts');
    revalidatePath(`/admin/exam-cohorts/${cohortId}`);
    return { status: 'success', message: '班別已連結課程。' };
  } catch (error) {
    return { status: 'error', message: error instanceof UserFacingOperationError ? error.message : safeOperationMessage(error, '連結課程失敗，請稍後再試。', 'link-cohort-course') };
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

    return { status: 'success', message: '未來課堂已建立。' };
  } catch (error) {
    return { status: 'error', message: error instanceof UserFacingOperationError ? error.message : safeOperationMessage(error, '建立課堂失敗，請稍後再試。', 'create-lesson-session') };
  }
}
