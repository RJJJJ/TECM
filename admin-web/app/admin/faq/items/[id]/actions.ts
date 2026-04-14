'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { verifyActiveStaffAccess } from '@/lib/auth/staff-access';

export type UpdateFaqItemFormState = {
  status: 'idle' | 'success' | 'error';
  message?: string;
};

export async function updateFaqItemAction(
  itemId: string,
  _prevState: UpdateFaqItemFormState,
  formData: FormData
): Promise<UpdateFaqItemFormState> {
  const topicId = String(formData.get('topic_id') ?? '').trim();
  const question = String(formData.get('question') ?? '').trim();
  const answer = String(formData.get('answer') ?? '').trim();
  const isPopular = String(formData.get('is_popular') ?? 'false') === 'true';
  const isActive = String(formData.get('is_active') ?? 'true') === 'true';
  const sortOrderRaw = String(formData.get('sort_order') ?? '').trim();

  if (!topicId) {
    return { status: 'error', message: 'Topic 為必填。' };
  }

  if (!question) {
    return { status: 'error', message: 'Question 為必填。' };
  }

  if (!answer) {
    return { status: 'error', message: 'Answer 為必填。' };
  }

  const sortOrder = Number(sortOrderRaw || '0');
  if (!Number.isFinite(sortOrder)) {
    return { status: 'error', message: 'Sort order 必須是數字。' };
  }

  const supabase = createServerSupabaseClient();
  const access = await verifyActiveStaffAccess(supabase);

  if (!access.allowed) {
    await supabase.auth.signOut();
    return {
      status: 'error',
      message: '你沒有權限更新 FAQ item。'
    };
  }

  const { data: topic, error: topicError } = await supabase
    .from('faq_topics')
    .select('id')
    .eq('id', topicId)
    .maybeSingle();

  if (topicError || !topic) {
    return {
      status: 'error',
      message: 'Topic 不存在，請重新選擇。'
    };
  }

  const { data, error } = await supabase
    .from('faq_items')
    .update({
      topic_id: topic.id,
      question,
      answer,
      is_popular: isPopular,
      is_active: isActive,
      sort_order: sortOrder
    })
    .eq('id', itemId)
    .select('id')
    .single();

  if (error || !data) {
    return {
      status: 'error',
      message: error?.message ?? '更新 FAQ item 失敗，請稍後再試。'
    };
  }

  revalidatePath('/admin/faq');
  revalidatePath(`/admin/faq/items/${itemId}`);

  return {
    status: 'success',
    message: 'FAQ item 已更新。'
  };
}
