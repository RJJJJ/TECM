'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { verifyActiveStaffAccess } from '@/lib/auth/staff-access';

export type ExamCohortFormState = {
  status: 'idle' | 'success' | 'error';
  message?: string;
};

async function requireStaff() {
  const supabase = await createServerSupabaseClient();
  const access = await verifyActiveStaffAccess(supabase);
  if (!access.allowed) {
    await supabase.auth.signOut();
    throw new Error('Unauthorized admin operation.');
  }
  return supabase;
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

  if (!name || !subject || !level || !examDate || !weekdayPattern) {
    return { status: 'error', message: 'Name, subject, level, exam date and weekday are required.' };
  }

  try {
    const supabase = await requireStaff();
    const { error } = await supabase.from('exam_cohorts').insert({
      name,
      subject,
      level,
      exam_date: examDate,
      weekday_pattern: weekdayPattern,
      lead_teacher_id: leadTeacherId,
      status
    });

    if (error) return { status: 'error', message: error.message };

    revalidatePath('/admin/exam-cohorts');
    return { status: 'success', message: 'Exam cohort created.' };
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : 'Create failed.' };
  }
}

export async function addCohortStudentAction(
  cohortId: string,
  _prevState: ExamCohortFormState,
  formData: FormData
): Promise<ExamCohortFormState> {
  const studentId = text(formData, 'student_id');
  if (!studentId) return { status: 'error', message: 'Student ID is required.' };

  try {
    const supabase = await requireStaff();
    const { error } = await supabase.from('cohort_students').insert({
      cohort_id: cohortId,
      student_id: studentId,
      status: 'active'
    });

    if (error) return { status: 'error', message: error.message };

    revalidatePath('/admin/exam-cohorts');
    revalidatePath(`/admin/exam-cohorts/${cohortId}`);
    return { status: 'success', message: 'Student added to cohort.' };
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : 'Add student failed.' };
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
      title: text(formData, `title_${sequenceNo}`) || `Lesson ${sequenceNo}`,
      teaching_content: nullableText(formData, `teaching_content_${sequenceNo}`),
      makeup_guidance: nullableText(formData, `makeup_guidance_${sequenceNo}`)
    };
  });

  try {
    const supabase = await requireStaff();
    const { error } = await supabase
      .from('lesson_plans')
      .upsert(rows, { onConflict: 'cohort_id,sequence_no' });

    if (error) return { status: 'error', message: error.message };

    revalidatePath(`/admin/exam-cohorts/${cohortId}`);
    revalidatePath(`/admin/exam-cohorts/${cohortId}/lesson-plans`);
    return { status: 'success', message: 'Lesson plans saved.' };
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : 'Save failed.' };
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

  if (!lessonPlanId || !teacherId || !startsAt || !endsAt) {
    return { status: 'error', message: 'Lesson, teacher, start time and end time are required.' };
  }

  if (!['scheduled', 'completed', 'cancelled'].includes(status)) {
    return { status: 'error', message: 'Invalid lesson session status.' };
  }

  if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
    return { status: 'error', message: 'End time must be after start time.' };
  }

  try {
    const supabase = await requireStaff();

    const [{ data: lessonPlan }, { data: teacher }] = await Promise.all([
      supabase.from('lesson_plans').select('id').eq('id', lessonPlanId).eq('cohort_id', cohortId).maybeSingle(),
      supabase.from('teacher_profiles').select('id').eq('id', teacherId).eq('is_active', true).maybeSingle()
    ]);

    if (!lessonPlan) return { status: 'error', message: 'Selected lesson does not belong to this cohort.' };
    if (!teacher) return { status: 'error', message: 'Selected teacher is not active.' };

    const { data: duplicate } = await supabase
      .from('lesson_sessions')
      .select('id')
      .eq('cohort_id', cohortId)
      .eq('lesson_plan_id', lessonPlanId)
      .eq('starts_at', startsAt)
      .maybeSingle();

    if (duplicate) return { status: 'error', message: 'A session for this lesson and start time already exists.' };

    const { error } = await supabase.from('lesson_sessions').insert({
      cohort_id: cohortId,
      lesson_plan_id: lessonPlanId,
      teacher_id: teacherId,
      starts_at: startsAt,
      ends_at: endsAt,
      status
    });

    if (error) return { status: 'error', message: error.message };

    revalidatePath(`/admin/exam-cohorts/${cohortId}`);
    revalidatePath(`/admin/exam-cohorts/${cohortId}/lesson-sessions`);
    return { status: 'success', message: 'Lesson session created.' };
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : 'Create session failed.' };
  }
}
