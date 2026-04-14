'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { verifyActiveStaffAccess } from '@/lib/auth/staff-access';

export type UpdateNewsFormState = {
  status: 'idle' | 'success' | 'error';
  message?: string;
};

function parsePublishedAt(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export async function updateNewsAction(
  newsId: string,
  _prevState: UpdateNewsFormState,
  formData: FormData
): Promise<UpdateNewsFormState> {
  const title = String(formData.get('title') ?? '').trim();
  const summary = String(formData.get('summary') ?? '').trim();
  const content = String(formData.get('content') ?? '').trim();
  const isActiveRaw = String(formData.get('is_active') ?? 'true').trim();
  const publishedAtRaw = String(formData.get('published_at') ?? '').trim();

  if (!title) {
    return { status: 'error', message: 'Title 為必填。' };
  }

  if (!publishedAtRaw) {
    return { status: 'error', message: 'Publish date 為必填。' };
  }

  const publishedAt = parsePublishedAt(publishedAtRaw);
  if (!publishedAt) {
    return { status: 'error', message: 'Publish date 格式錯誤。' };
  }

  const isActive = isActiveRaw === 'true';

  const supabase = createServerSupabaseClient();
  const access = await verifyActiveStaffAccess(supabase);

  if (!access.allowed) {
    await supabase.auth.signOut();
    return {
      status: 'error',
      message: '你沒有權限更新 news。'
    };
  }

  const { data, error } = await supabase
    .from('news_items')
    .update({
      title,
      summary: summary || null,
      content: content || null,
      is_active: isActive,
      published_at: publishedAt
    })
    .eq('id', newsId)
    .select('id')
    .single();

  if (error || !data) {
    return { status: 'error', message: error?.message ?? '更新失敗，請稍後再試。' };
  }

  revalidatePath('/admin/news');
  revalidatePath(`/admin/news/${newsId}`);

  return {
    status: 'success',
    message: 'News 已更新。'
  };
}
