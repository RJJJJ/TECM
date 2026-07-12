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

  const { data: organizationMember, error: membershipError } = await supabase
    .from('organization_members')
    .select('user_id, status, role')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .in('role', ['admin', 'staff', 'teacher'])
    .limit(1)
    .maybeSingle();

  if (!membershipError && organizationMember) return { allowed: true, user };

  // Compatibility fallback while an existing deployment is moving from the
  // global v1 role table to organization_members.
  const { data: staffRole, error } = await supabase
    .from('staff_roles')
    .select('user_id, is_active')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .maybeSingle();

  if (error || !staffRole) return { allowed: false, user };

  return {
    allowed: true,
    user
  };
}
