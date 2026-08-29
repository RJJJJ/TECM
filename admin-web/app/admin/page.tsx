import { redirect } from 'next/navigation';
import { getOperationsContext } from '@/lib/operations/context';

export default async function AdminPage() {
  const { role } = await getOperationsContext();
  redirect(role === 'teacher' ? '/admin/attendance' : '/admin/dashboard');
}
