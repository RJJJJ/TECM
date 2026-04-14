'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { verifyActiveStaffAccess } from '@/lib/auth/staff-access';

export type UpdateFaqTopicFormState = {
  status: 'idle' | 'success' | 'error';
  message?: string;
};

export async function updateFaqTopicAction(
  topicId: string,
  _prevState: UpdateFaqTopicFormState,
  formData: FormData
): Promise<UpdateFaqTopicFormState> {
  const name = String(formData.get('name') ?? '').trim();
  const sortOrderRaw = String(formData.get('sort_order') ?? '').trim();

  if (!name) {
    return { status: 'error', message: 'Topic name 為必填。' };
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
      message: '你沒有權限更新 FAQ topic。'
    };
  }

  const { data, error } = await supabase
    .from('faq_topics')
    .update({
      name,
      sort_order: sortOrder
    })
    .eq('id', topicId)
    .select('id')
    .single();

  if (error || !data) {
    if (error?.code === '23505') {
      return {
        status: 'error',
        message: 'Topic name 已存在，請使用其他名稱。'
      };
    }

    return {
      status: 'error',
      message: error?.message ?? '更新 FAQ topic 失敗，請稍後再試。'
    };
  }

  revalidatePath('/admin/faq');
  revalidatePath(`/admin/faq/topics/${topicId}`);

  return {
    status: 'success',
    message: 'FAQ topic 已更新。'
  };
}
