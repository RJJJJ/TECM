'use server';

import { revalidatePath } from 'next/cache';
import { getOperationsContext } from '@/lib/operations/context';

const text = (form: FormData, key: string) => String(form.get(key) ?? '').trim();

export async function publishAnnouncementAction(form: FormData): Promise<void> {
  const context = await getOperationsContext();
  if (!['admin', 'staff'].includes(context.role)) throw new Error('只有管理員或職員可以發送通知。');
  const title = text(form, 'title');
  const body = text(form, 'body');
  const category = text(form, 'category') || 'announcement';
  const deepLink = text(form, 'deep_link') || null;
  if (!title || title.length > 120 || !body || body.length > 2000) throw new Error('標題或內容長度無效。');
  const { error } = await context.supabase.rpc('publish_notification_announcement', {
    p_organization_id: context.organizationId,
    p_title: title,
    p_body: body,
    p_category: category,
    p_deep_link: deepLink
  });
  if (error) throw error;
  revalidatePath('/admin/notifications');
}

export async function saveNotificationTemplateAction(form: FormData): Promise<void> {
  const context = await getOperationsContext();
  if (!['admin', 'staff'].includes(context.role)) throw new Error('未獲授權管理通知範本。');
  const templateKey = text(form, 'template_key').toLowerCase();
  const name = text(form, 'name'); const title = text(form, 'title'); const body = text(form, 'body');
  const category = text(form, 'category') || 'announcement'; const deepLink = text(form, 'deep_link') || null;
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(templateKey) || !name || name.length > 100 || !title || title.length > 120 || !body || body.length > 2000) throw new Error('通知範本資料無效。');
  const { error } = await context.supabase.from('notification_templates').upsert({
    organization_id: context.organizationId, template_key: templateKey, name, title, body, category,
    deep_link: deepLink, is_active: true, created_by: context.user.id
  }, { onConflict: 'organization_id,template_key' });
  if (error) throw error;
  revalidatePath('/admin/notifications');
}
