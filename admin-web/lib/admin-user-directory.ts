import { createServiceRoleSupabaseClient } from '@/lib/supabase/service-role';

/**
 * Resolve human-readable login labels on the server only. UUIDs stay inside
 * the server-side lookup and are never rendered into ordinary operator tables.
 */
export async function loadAdminUserDirectory() {
  const service = createServiceRoleSupabaseClient();
  const directory = new Map<string, string>();
  const perPage = 1000;

  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    for (const user of data.users) {
      directory.set(user.id, user.email ?? '未設定登入電郵');
    }
    if (data.users.length < perPage) break;
  }

  return directory;
}
