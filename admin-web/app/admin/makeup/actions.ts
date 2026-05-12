'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { verifyActiveStaffAccess } from '@/lib/auth/staff-access';

export type MakeupFormState = {
  status: 'idle' | 'success' | 'error';
  message?: string;
};

async function requireStaff() {
  const supabase = createServerSupabaseClient();
  const access = await verifyActiveStaffAccess(supabase);
  if (!access.allowed) {
    await supabase.auth.signOut();
    throw new Error('Unauthorized admin operation.');
  }
  return supabase;
}

export async function scheduleMakeupSessionAction(
  makeupTaskId: string,
  studentId: string,
  _prevState: MakeupFormState,
  formData: FormData
): Promise<MakeupFormState> {
  const scheduledAt = String(formData.get('scheduled_at') ?? '').trim();
  const teacherId = String(formData.get('teacher_id') ?? '').trim() || null;

  if (!scheduledAt) return { status: 'error', message: 'Scheduled time is required.' };

  try {
    const supabase = await requireStaff();
    const { error: sessionError } = await supabase.from('makeup_sessions').insert({
      makeup_task_id: makeupTaskId,
      student_id: studentId,
      teacher_id: teacherId,
      scheduled_at: scheduledAt,
      status: 'scheduled'
    });

    if (sessionError) return { status: 'error', message: sessionError.message };

    const { error: taskError } = await supabase
      .from('makeup_tasks')
      .update({ status: 'scheduled' })
      .eq('id', makeupTaskId);

    if (taskError) return { status: 'error', message: taskError.message };

    revalidatePath('/admin/makeup');
    revalidatePath(`/admin/makeup/${makeupTaskId}`);
    revalidatePath('/admin/makeup/schedule');
    return { status: 'success', message: 'Makeup session scheduled.' };
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : 'Schedule failed.' };
  }
}

export async function completeMakeupTaskAction(makeupTaskId: string): Promise<void> {
  const supabase = await requireStaff();
  await supabase.from('makeup_tasks').update({ status: 'completed' }).eq('id', makeupTaskId);
  await supabase
    .from('makeup_sessions')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('makeup_task_id', makeupTaskId)
    .eq('status', 'scheduled');
  revalidatePath('/admin/makeup');
  revalidatePath(`/admin/makeup/${makeupTaskId}`);
}
