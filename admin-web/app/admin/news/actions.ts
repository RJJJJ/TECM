'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { verifyActiveStaffAccess } from '@/lib/auth/staff-access';

export type CreateNewsFormState = {
  status: 'idle' | 'success' | 'error';
  message?: string;
};

function normalizeOptionalText(value: FormDataEntryValue | null) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function parsePublishedAt(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export async function createNewsAction(
  _prevState: CreateNewsFormState,
  formData: FormData
): Promise<CreateNewsFormState> {
  const category = normalizeOptionalText(formData.get('category'));
  const title = String(formData.get('title') ?? '').trim();
  const summary = normalizeOptionalText(formData.get('summary'));
  const content = normalizeOptionalText(formData.get('content'));
  const imageUrl = normalizeOptionalText(formData.get('image_url'));
  const isFeatured = String(formData.get('is_featured') ?? 'false') === 'true';
  const isActive = String(formData.get('is_active') ?? 'true') === 'true';
  const publishedAtRaw = String(formData.get('published_at') ?? '').trim();
  const sortOrderRaw = String(formData.get('sort_order') ?? '').trim();

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

  if (!sortOrderRaw) {
    return { status: 'error', message: 'Sort order 為必填。' };
  }

  const sortOrder = Number(sortOrderRaw);
  if (!Number.isFinite(sortOrder)) {
    return { status: 'error', message: 'Sort order 必須是數字。' };
  }

  const supabase = createServerSupabaseClient();
  const access = await verifyActiveStaffAccess(supabase);

  if (!access.allowed) {
    await supabase.auth.signOut();
    return {
      status: 'error',
      message: '你沒有權限新增 news。'
    };
  }

  const { data, error } = await supabase
    .from('news_items')
    .insert({
      category,
      title,
      summary,
      content,
      image_url: imageUrl,
      is_featured: isFeatured,
      is_active: isActive,
      published_at: publishedAt,
      sort_order: sortOrder
    })
    .select('id')
    .single();

  if (error || !data) {
    return { status: 'error', message: error?.message ?? '新增失敗，請稍後再試。' };
  }

  revalidatePath('/admin/news');

  return {
    status: 'success',
    message: 'News 已新增。'
  };
}
