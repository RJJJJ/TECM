'use server';

import { revalidatePath } from 'next/cache';
import { getOperationsContext } from '@/lib/operations/context';
import { safeOperationMessage, UserFacingOperationError, userFacingError } from '@/lib/operations/errors';

export type UpdateFaqItemFormState = { status: 'idle' | 'success' | 'error'; message?: string };

export async function updateFaqItemAction(itemId: string, _prevState: UpdateFaqItemFormState, formData: FormData): Promise<UpdateFaqItemFormState> {
  const topicId = String(formData.get('topic_id') ?? '').trim();
  const question = String(formData.get('question') ?? '').trim();
  const answer = String(formData.get('answer') ?? '').trim();
  const isPopular = String(formData.get('is_popular') ?? 'false') === 'true';
  const isActive = String(formData.get('is_active') ?? 'true') === 'true';
  const sortOrder = Number(String(formData.get('sort_order') ?? '').trim() || '0');
  if (!topicId) return { status: 'error', message: '請選擇分類。' };
  if (!question) return { status: 'error', message: '問題為必填。' };
  if (!answer) return { status: 'error', message: '答案為必填。' };
  if (!Number.isFinite(sortOrder)) return { status: 'error', message: '排序次序必須是數字。' };
  try {
    const context = await getOperationsContext();
    if (!['admin', 'staff'].includes(context.role)) throw userFacingError('只有管理員或職員可以管理常見問題。');
    const { data: topic, error: topicError } = await context.supabase.from('faq_topics').select('id').eq('id', topicId).eq('organization_id', context.organizationId).maybeSingle();
    if (topicError || !topic) throw topicError ?? userFacingError('所選分類已不存在或不屬於目前機構，請重新選擇。');
    const { data, error } = await context.supabase.from('faq_items').update({ topic_id: topic.id, question, answer, is_popular: isPopular, is_active: isActive, sort_order: sortOrder }).eq('id', itemId).eq('organization_id', context.organizationId).select('id').single();
    if (error || !data) throw error ?? userFacingError('所選常見問題已不存在或不屬於目前機構。');
    revalidatePath('/admin/faq');
    revalidatePath(`/admin/faq/items/${itemId}`);
    return { status: 'success', message: '常見問題已更新。' };
  } catch (error) {
    return { status: 'error', message: error instanceof UserFacingOperationError ? error.message : safeOperationMessage(error, '更新常見問題失敗，請稍後再試。', 'update-faq-item') };
  }
}
