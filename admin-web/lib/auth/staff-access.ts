import { type SupabaseClient, type User } from '@supabase/supabase-js';

type StaffAccessResult = {
  allowed: boolean;
  user: User | null;
};

export async function verifyActiveStaffAccess(
  supabase: SupabaseClient
): Promise<StaffAccessResult> {
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      allowed: false,
      user: null
    };
  }

  const { data: staffRole, error } = await supabase
    .from('staff_roles')
    .select('user_id, is_active')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .maybeSingle();

  if (error || !staffRole) {
    return {
      allowed: false,
      user
    };
  }

  return {
    allowed: true,
    user
  };
}
