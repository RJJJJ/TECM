'use server';

import { revalidatePath } from 'next/cache';
import type { OperationState } from '@/lib/operations/actions';
import { getOperationsContext } from '@/lib/operations/context';
import { safeOperationMessage, UserFacingOperationError, userFacingError } from '@/lib/operations/errors';

const value = (form: FormData, key: string) => String(form.get(key) ?? '').trim();

export async function createFeePlanAction(_: OperationState, form: FormData): Promise<OperationState> {
  try {
    const context = await getOperationsContext();
    if (!['admin', 'staff'].includes(context.role)) throw userFacingError('只有管理員或職員可以建立套票。');
    const name = value(form, 'name');
    const creditUnits = Number(value(form, 'credit_units'));
    const amountMinor = Number(value(form, 'amount_minor'));
    const courseId = value(form, 'course_id');
    if (!name || name.length > 120 || !Number.isInteger(creditUnits) || creditUnits < 1 || !Number.isInteger(amountMinor) || amountMinor < 0) throw userFacingError('請輸入有效的套票名稱、堂數及金額。');
    if (courseId) {
      const { data: course, error } = await context.supabase.from('courses').select('id').eq('id', courseId).eq('organization_id', context.organizationId).maybeSingle();
      if (error) throw error;
      if (!course) throw userFacingError('所選課程不存在或不屬於目前機構。');
    }
    const { error } = await context.supabase.from('fee_plans').insert({ organization_id: context.organizationId, name, course_id: courseId || null, credit_units: creditUnits, amount_minor: amountMinor, currency_code: 'MOP', is_active: true });
    if (error) throw error;
    revalidatePath('/admin/packages');
    revalidatePath('/admin/students');
    revalidatePath('/admin/dashboard');
    return { status: 'success', message: '套票已建立。' };
  } catch (error) {
    return { status: 'error', message: error instanceof UserFacingOperationError ? error.message : safeOperationMessage(error, '建立套票失敗，請稍後再試。', 'create-fee-plan') };
  }
}
