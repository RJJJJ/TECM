import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { verifyActiveStaffAccess } from '@/lib/auth/staff-access';
import AdminShell from '@/components/admin-shell';

export default async function AdminLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const supabase = await createServerSupabaseClient();
  const access = await verifyActiveStaffAccess(supabase);

  if (!access.allowed) {
    await supabase.auth.signOut();
    redirect('/login?error=unauthorized');
  }

  const { data: membership } = await supabase.from('organization_members').select('role,organizations(name)').eq('user_id', access.user!.id).eq('status', 'active').limit(1).maybeSingle();
  const organization = membership?.organizations as unknown as { name?: string } | null;
  return <AdminShell organizationName={organization?.name} role={membership?.role}>{children}</AdminShell>;
}
