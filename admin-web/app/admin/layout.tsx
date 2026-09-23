import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { verifyActiveStaffAccess } from '@/lib/auth/staff-access';
import { getOperationsContext } from '@/lib/operations/context';
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

  const context = await getOperationsContext();
  return <AdminShell organizationName={context.organizationName} role={context.role}>{children}</AdminShell>;
}
