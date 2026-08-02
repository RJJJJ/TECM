'use server';

import { revalidatePath } from 'next/cache';
import { getOperationsContext } from '@/lib/operations/context';
import { safeOperationMessage, UserFacingOperationError, userFacingError } from '@/lib/operations/errors';

export type CreateFaqTopicFormState = { status: 'idle' | 'success' | 'error'; message?: string };
export type CreateFaqItemFormState = { status: 'idle' | 'success' | 'error'; message?: string };

function parseSortOrder(raw: string) {
  const value = Number(raw || '0');
  return Number.isFinite(value) ? value : null;
}

async function requireManager() {
  const context = await getOperationsContext();
  if (!['admin', 'staff'].includes(context.role)) throw userFacingError('只有管理員或職員可以管理常見問題。');
  return context;
}

export async function createFaqTopicAction(_prevState: CreateFaqTopicFormState, formData: FormData): Promise<CreateFaqTopicFormState> {
  const name = String(formData.get('name') ?? '').trim();
  const sortOrder = parseSortOrder(String(formData.get('sort_order') ?? '').trim());
  if (!name) return { status: 'error', message: '分類名稱為必填。' };
  if (sortOrder === null) return { status: 'error', message: '排序次序必須是數字。' };
  try {
    const context = await requireManager();
    const { data, error } = await context.supabase.from('faq_topics').insert({ organization_id: context.organizationId, name, sort_order: sortOrder }).select('id').single();
    if (error || !data) throw error ?? new Error('FAQ 分類建立後沒有回傳資料');
    revalidatePath('/admin/faq');
    return { status: 'success', message: '常見問題分類已新增。' };
  } catch (error) {
    return { status: 'error', message: error instanceof UserFacingOperationError ? error.message : safeOperationMessage(error, '新增常見問題分類失敗，請稍後再試。', 'create-faq-topic') };
  }
}

export async function createFaqItemAction(_prevState: CreateFaqItemFormState, formData: FormData): Promise<CreateFaqItemFormState> {
  const topicId = String(formData.get('topic_id') ?? '').trim();
  const question = String(formData.get('question') ?? '').trim();
  const answer = String(formData.get('answer') ?? '').trim();
  const isPopular = String(formData.get('is_popular') ?? 'false') === 'true';
  const isActive = String(formData.get('is_active') ?? 'true') === 'true';
  const sortOrder = parseSortOrder(String(formData.get('sort_order') ?? '').trim());
  if (!topicId) return { status: 'error', message: '請選擇分類。' };
  if (!question) return { status: 'error', message: '問題為必填。' };
  if (!answer) return { status: 'error', message: '答案為必填。' };
  if (sortOrder === null) return { status: 'error', message: '排序次序必須是數字。' };
  try {
    const context = await requireManager();
    const { data: topic, error: topicError } = await context.supabase.from('faq_topics').select('id').eq('id', topicId).eq('organization_id', context.organizationId).maybeSingle();
    if (topicError || !topic) throw topicError ?? userFacingError('所選分類已不存在或不屬於目前機構，請重新選擇。');
    const { data, error } = await context.supabase.from('faq_items').insert({ organization_id: context.organizationId, topic_id: topic.id, question, answer, is_popular: isPopular, is_active: isActive, sort_order: sortOrder }).select('id').single();
    if (error || !data) throw error ?? new Error('FAQ item insert returned no row');
    revalidatePath('/admin/faq');
    return { status: 'success', message: '常見問題已新增。' };
  } catch (error) {
    return { status: 'error', message: error instanceof UserFacingOperationError ? error.message : safeOperationMessage(error, '新增常見問題失敗，請稍後再試。', 'create-faq-item') };
  }
}
