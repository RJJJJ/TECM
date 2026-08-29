'use server';

import type { OperationState } from '@/lib/operations/actions';
import { getOperationsContext } from '@/lib/operations/context';
import { safeOperationMessage, UserFacingOperationError, userFacingError } from '@/lib/operations/errors';

const value = (form: FormData, key: string) => String(form.get(key) ?? '').trim();

export async function createCampusAction(_: OperationState, form: FormData): Promise<OperationState> {
  try {
    const context = await getOperationsContext();
    if (!['admin', 'staff'].includes(context.role)) throw userFacingError('只有管理員或職員可以建立校區。');
    const name = value(form, 'name');
    if (!name || name.length > 120) throw userFacingError('請輸入校區名稱（最多 120 字）。');

    const { error } = await context.supabase.from('campuses').insert({
      organization_id: context.organizationId,
      name,
      address: value(form, 'address') || null,
      is_active: true
    });
    if (error) throw error;
    return { status: 'success', message: '校區已建立。' };
  } catch (error) {
    return { status: 'error', message: error instanceof UserFacingOperationError ? error.message : safeOperationMessage(error, '建立校區失敗，請稍後再試。', 'create-campus') };
  }
}
