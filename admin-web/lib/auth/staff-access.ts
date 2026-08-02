import { type SupabaseClient, type User } from '@supabase/supabase-js';

export type StaffMembership = {
  organization_id: string;
  role: 'admin' | 'staff' | 'teacher';
  status: 'active';
  organizations: { name?: string | null } | null;
};

type StaffAccessResult = {
  allowed: boolean;
  user: User | null;
  memberships: StaffMembership[];
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
      user: null,
      memberships: []
    };
  }

  const { data: membershipData, error: membershipError } = await supabase
    .from('organization_members')
    .select('organization_id, status, role, organizations(name)')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .in('role', ['admin', 'staff', 'teacher'])
    .order('created_at');

  if (membershipError || !membershipData?.length) return { allowed: false, user, memberships: [] };

  return {
    allowed: true,
    user,
    memberships: membershipData as unknown as StaffMembership[]
  };
}
