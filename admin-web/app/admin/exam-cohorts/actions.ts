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
