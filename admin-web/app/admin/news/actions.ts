'use server';

import { revalidatePath } from 'next/cache';
import { getOperationsContext } from '@/lib/operations/context';
import { safeOperationMessage, UserFacingOperationError, userFacingError } from '@/lib/operations/errors';

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

  if (!title) return { status: 'error', message: '標題為必填。' };
  if (!publishedAtRaw) return { status: 'error', message: '發佈日期為必填。' };
  const publishedAt = parsePublishedAt(publishedAtRaw);
  if (!publishedAt) return { status: 'error', message: '發佈日期格式錯誤。' };
  if (!sortOrderRaw) return { status: 'error', message: '排序次序為必填。' };
  const sortOrder = Number(sortOrderRaw);
  if (!Number.isFinite(sortOrder)) return { status: 'error', message: '排序次序必須是數字。' };

  try {
    const context = await getOperationsContext();
    if (!['admin', 'staff'].includes(context.role)) throw userFacingError('只有管理員或職員可以管理最新消息。');
    const { data, error } = await context.supabase.from('news_items').insert({
      organization_id: context.organizationId,
      category,
      title,
      summary,
      content,
      image_url: imageUrl,
      is_featured: isFeatured,
      is_active: isActive,
      published_at: publishedAt,
      sort_order: sortOrder
    }).select('id').single();
    if (error || !data) throw error ?? new Error('news insert returned no row');
    revalidatePath('/admin/news');
    return { status: 'success', message: '最新消息已新增。' };
  } catch (error) {
    return { status: 'error', message: error instanceof UserFacingOperationError ? error.message : safeOperationMessage(error, '新增最新消息失敗，請稍後再試。', 'create-news') };
  }
}
