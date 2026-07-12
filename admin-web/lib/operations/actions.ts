'use server';

import { revalidatePath } from 'next/cache';
import { getOperationsContext } from './context';

export type OperationState = { status: 'idle' | 'success' | 'error'; message?: string };
const ok = (message: string): OperationState => ({ status: 'success', message });
const fail = (error: unknown): OperationState => ({ status: 'error', message: error instanceof Error ? error.message : '操作失敗，請稍後再試。' });
const value = (data: FormData, key: string) => String(data.get(key) ?? '').trim();

export async function createGuardianStudentAction(_: OperationState, form: FormData): Promise<OperationState> {
  try {
    const ctx = await getOperationsContext();
    const guardianName = value(form, 'guardian_name'); const phone = value(form, 'phone'); const studentName = value(form, 'student_name');
    if (!guardianName || !phone || !studentName || !value(form, 'class_group_id') || !value(form, 'fee_plan_id')) throw new Error('請填寫家長、學生、班別及套票資料。');
    const { data, error } = await ctx.supabase.rpc('create_guardian_student_enrollment_package', {
      target_organization_id: ctx.organizationId, target_guardian_name: guardianName, target_guardian_phone: phone,
      target_student_name: studentName, target_school_name: value(form, 'school_name') || null,
      target_cohort_id: value(form, 'class_group_id') || null, target_fee_plan_id: value(form, 'fee_plan_id') || null,
      target_idempotency_key: value(form, 'idempotency_key') || crypto.randomUUID()
    });
    if (error) throw error; void data;
    revalidatePath('/admin/students'); revalidatePath('/admin/guardians'); revalidatePath('/admin/classes'); revalidatePath('/admin/packages');
    return ok('已建立家長、學生、報班及套票資料。');
  } catch (error) { return fail(error); }
}

export async function recordPaymentAction(_: OperationState, form: FormData): Promise<OperationState> {
  try {
    const ctx = await getOperationsContext(); const chargeId = value(form, 'charge_id'); const guardianId = value(form, 'guardian_id'); const amount = Number(value(form, 'amount_minor'));
    if (!chargeId || !Number.isInteger(amount) || amount <= 0) throw new Error('請選擇收費項目及輸入有效的整數金額（最小貨幣單位）。');
    const { error } = await ctx.supabase.rpc('record_payment', { target_organization_id: ctx.organizationId, target_guardian_id: guardianId || null, target_charge_id: chargeId, target_amount_minor: amount, target_method: value(form, 'method'), target_idempotency_key: value(form, 'idempotency_key') || crypto.randomUUID() });
    if (error) throw error; revalidatePath('/admin/payments'); revalidatePath('/admin/packages'); return ok('付款已記錄，結餘已更新。');
  } catch (error) { return fail(error); }
}

export async function submitAttendanceAction(_: OperationState, form: FormData): Promise<OperationState> {
  try {
    const ctx = await getOperationsContext(); const sessionId = value(form, 'session_id'); const studentId = value(form, 'student_id'); const status = value(form, 'status');
    if (!sessionId || !studentId || !['present','absent','excused','makeup_completed'].includes(status)) throw new Error('請選擇課堂、學生及有效狀態。');
    const { error } = await ctx.supabase.rpc('submit_attendance', { target_session_id: sessionId, records: [{ student_id: studentId, status, internal_note: value(form, 'note') || null }] });
    if (error) throw error; revalidatePath('/admin/attendance'); revalidatePath('/admin/leave-makeup'); return ok('點名已儲存。');
  } catch (error) { return fail(error); }
}

export async function submitSessionAttendanceAction(_: OperationState, form: FormData): Promise<OperationState> {
  try {
    const ctx = await getOperationsContext();
    const sessionId = value(form, 'session_id');
    const records = Array.from(form.entries())
      .filter(([key]) => key.startsWith('attendance:'))
      .map(([key, recordStatus]) => ({
        student_id: key.slice('attendance:'.length),
        status: String(recordStatus),
        internal_note: null
      }));
    if (!sessionId || records.length === 0) throw new Error('這節課沒有可提交的學生點名。');
    if (records.some((record) => !['present', 'absent', 'excused'].includes(record.status))) throw new Error('點名狀態無效。');
    const { error } = await ctx.supabase.rpc('submit_attendance', { target_session_id: sessionId, records });
    if (error) throw error;
    revalidatePath('/admin/attendance'); revalidatePath('/admin/sessions'); revalidatePath('/admin/packages'); revalidatePath('/admin/dashboard');
    return ok(`已儲存 ${records.length} 位學生的點名；重複提交不會重複扣堂。`);
  } catch (error) { return fail(error); }
}

export async function decideLeaveRequestAction(form: FormData): Promise<void> {
  const ctx = await getOperationsContext();
  const leaveRequestId = value(form, 'leave_request_id');
  const decision = value(form, 'decision');
  if (!leaveRequestId || !['approved', 'rejected'].includes(decision)) throw new Error('請假決定無效。');
  const { error } = await ctx.supabase.rpc('decide_leave_request', {
    target_leave_request_id: leaveRequestId,
    target_status: decision
  });
  if (error) throw error;
  revalidatePath('/admin/leave-makeup'); revalidatePath('/admin/dashboard');
}

export async function createLeaveRequestAction(_: OperationState, form: FormData): Promise<OperationState> {
  try {
    const ctx = await getOperationsContext(); const studentId = value(form, 'student_id'); const sessionId = value(form, 'session_id');
    const reason = value(form, 'reason');
    if (!studentId || !sessionId || !reason) throw new Error('請選擇學生、課堂及填寫請假原因。');
    const { error } = await ctx.supabase.from('leave_requests').insert({ organization_id: ctx.organizationId, student_id: studentId, lesson_session_id: sessionId, reason, status: 'pending', requested_by: ctx.user.id });
    if (error) throw error; revalidatePath('/admin/leave-makeup'); return ok('請假申請已建立。');
  } catch (error) { return fail(error); }
}

export async function createMakeupBookingAction(_: OperationState, form: FormData): Promise<OperationState> {
  try {
    const ctx = await getOperationsContext(); const entitlementId = value(form, 'entitlement_id'); const teacherId = value(form, 'teacher_id'); const scheduledAt = value(form, 'scheduled_at');
    if (!entitlementId || !teacherId || !scheduledAt) throw new Error('請選擇補課額、導師及補課時間。');
    const { error } = await ctx.supabase.rpc('book_makeup_session', { target_organization_id: ctx.organizationId, target_entitlement_id: entitlementId, target_teacher_id: teacherId || null, target_scheduled_at: `${scheduledAt}:00+08:00`, target_idempotency_key: value(form, 'idempotency_key') || crypto.randomUUID() });
    if (error) throw error; revalidatePath('/admin/leave-makeup'); revalidatePath('/admin/sessions'); return ok('補課預約已建立。');
  } catch (error) { return fail(error); }
}

export async function completeFollowUpAction(_: OperationState, form: FormData): Promise<OperationState> {
  try {
    const ctx = await getOperationsContext(); const id = value(form, 'follow_up_id'); if (!id) throw new Error('請選擇跟進事項。');
    const { error } = await ctx.supabase.from('follow_up_tasks').update({ status: 'done', completed_at: new Date().toISOString() }).eq('organization_id', ctx.organizationId).eq('id', id);
    if (error) throw error; revalidatePath('/admin/follow-ups'); revalidatePath('/admin/dashboard'); return ok('跟進事項已完成。');
  } catch (error) { return fail(error); }
}
