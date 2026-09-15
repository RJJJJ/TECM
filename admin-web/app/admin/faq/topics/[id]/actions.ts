'use server';

import { revalidatePath } from 'next/cache';
import { getOperationsContext } from '@/lib/operations/context';
import { safeOperationMessage, UserFacingOperationError, userFacingError } from '@/lib/operations/errors';

export type UpdateFaqTopicFormState = { status: 'idle' | 'success' | 'error'; message?: string };

export async function updateFaqTopicAction(topicId: string, _prevState: UpdateFaqTopicFormState, formData: FormData): Promise<UpdateFaqTopicFormState> {
  const name = String(formData.get('name') ?? '').trim();
  const sortOrder = Number(String(formData.get('sort_order') ?? '').trim() || '0');
  if (!name) return { status: 'error', message: '分類名稱為必填。' };
  if (!Number.isFinite(sortOrder)) return { status: 'error', message: '排序次序必須是數字。' };
  try {
    const context = await getOperationsContext();
    if (!['admin', 'staff'].includes(context.role)) throw userFacingError('只有管理員或職員可以管理常見問題。');
    const { data, error } = await context.supabase.from('faq_topics').update({ name, sort_order: sortOrder }).eq('id', topicId).eq('organization_id', context.organizationId).select('id').single();
    if (error || !data) throw error ?? userFacingError('所選分類已不存在或不屬於目前機構。');
    revalidatePath('/admin/faq');
    revalidatePath(`/admin/faq/topics/${topicId}`);
    return { status: 'success', message: '常見問題分類已更新。' };
  } catch (error) {
    return { status: 'error', message: error instanceof UserFacingOperationError ? error.message : safeOperationMessage(error, '更新常見問題分類失敗，請稍後再試。', 'update-faq-topic') };
  }
}
