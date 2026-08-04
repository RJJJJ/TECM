'use server';

import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { verifyActiveStaffAccess } from '@/lib/auth/staff-access';

export type LoginFormState = {
  error?: string;
};

const CREDENTIAL_LOGIN_ERROR = '電郵或密碼不正確。';

export async function loginAction(
  _prevState: LoginFormState,
  formData: FormData
): Promise<LoginFormState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  if (!email || !password) {
    return { error: '請輸入電郵與密碼。' };
  }

  const supabase = await createServerSupabaseClient();

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    // Keep unknown-email and wrong-password responses identical.
    return { error: CREDENTIAL_LOGIN_ERROR };
  }

  const access = await verifyActiveStaffAccess(supabase);

  if (!access.allowed) {
    await supabase.auth.signOut();
    return { error: '此帳號沒有後台權限或已停用。' };
  }

  redirect('/admin');
}
