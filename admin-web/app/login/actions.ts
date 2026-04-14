'use server';

import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { verifyActiveStaffAccess } from '@/lib/auth/staff-access';

export type LoginFormState = {
  error?: string;
};

const DEFAULT_LOGIN_ERROR = '登入失敗，請確認 Email 與密碼。';

export async function loginAction(
  _prevState: LoginFormState,
  formData: FormData
): Promise<LoginFormState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  if (!email || !password) {
    return { error: '請輸入 Email 與密碼。' };
  }

  const supabase = createServerSupabaseClient();

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    return { error: error.message || DEFAULT_LOGIN_ERROR };
  }

  const access = await verifyActiveStaffAccess(supabase);

  if (!access.allowed) {
    await supabase.auth.signOut();
    return { error: '此帳號沒有後台權限或已停用。' };
  }

  redirect('/admin/bookings');
}
