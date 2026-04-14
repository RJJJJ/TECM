'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { verifyActiveStaffAccess } from '@/lib/auth/staff-access';

export type CreateFaqTopicFormState = {
  status: 'idle' | 'success' | 'error';
  message?: string;
};

export type CreateFaqItemFormState = {
  status: 'idle' | 'success' | 'error';
  message?: string;
};

function parseSortOrder(raw: string) {
  const value = Number(raw || '0');
  if (!Number.isFinite(value)) return null;
  return value;
}

export async function createFaqTopicAction(
  _prevState: CreateFaqTopicFormState,
  formData: FormData
): Promise<CreateFaqTopicFormState> {
  const name = String(formData.get('name') ?? '').trim();
  const sortOrderRaw = String(formData.get('sort_order') ?? '').trim();

  if (!name) {
    return { status: 'error', message: 'Topic name 為必填。' };
  }

  const sortOrder = parseSortOrder(sortOrderRaw);
  if (sortOrder === null) {
    return { status: 'error', message: 'Sort order 必須是數字。' };
  }

  const supabase = createServerSupabaseClient();
  const access = await verifyActiveStaffAccess(supabase);

  if (!access.allowed) {
    await supabase.auth.signOut();
    return {
      status: 'error',
      message: '你沒有權限新增 FAQ topic。'
    };
  }

  const { data, error } = await supabase
    .from('faq_topics')
    .insert({
      name,
      sort_order: sortOrder
    })
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
      message: error?.message ?? '新增 FAQ topic 失敗，請稍後再試。'
    };
  }

  revalidatePath('/admin/faq');

  return {
    status: 'success',
    message: 'FAQ topic 已新增。'
  };
}

export async function createFaqItemAction(
  _prevState: CreateFaqItemFormState,
  formData: FormData
): Promise<CreateFaqItemFormState> {
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

  const sortOrder = parseSortOrder(sortOrderRaw);
  if (sortOrder === null) {
    return { status: 'error', message: 'Sort order 必須是數字。' };
  }

  const supabase = createServerSupabaseClient();
  const access = await verifyActiveStaffAccess(supabase);

  if (!access.allowed) {
    await supabase.auth.signOut();
    return {
      status: 'error',
      message: '你沒有權限新增 FAQ item。'
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
    .insert({
      topic_id: topic.id,
      question,
      answer,
      is_popular: isPopular,
      is_active: isActive,
      sort_order: sortOrder
    })
    .select('id')
    .single();

  if (error || !data) {
    return {
      status: 'error',
      message: error?.message ?? '新增 FAQ item 失敗，請稍後再試。'
    };
  }

  revalidatePath('/admin/faq');

  return {
    status: 'success',
    message: 'FAQ item 已新增。'
  };
}
