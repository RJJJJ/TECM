import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { verifyActiveStaffAccess } from '@/lib/auth/staff-access';
import { logoutAction } from './actions';

export default async function AdminLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const supabase = createServerSupabaseClient();
  const access = await verifyActiveStaffAccess(supabase);

  if (!access.allowed) {
    await supabase.auth.signOut();
    redirect('/login?error=unauthorized');
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 md:px-6 md:py-8">
      <header className="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Admin Console</p>
            <h1 className="text-lg font-semibold text-slate-900">TECM Admin Web</h1>
            <p className="text-sm text-slate-600">Bookings, Courses and News management operations</p>
          </div>
          <div className="flex items-center gap-2">
            <nav className="flex items-center gap-2" aria-label="Admin sections">
              <Link
                href="/admin/bookings"
                className="inline-flex rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
              >
                Bookings
              </Link>
              <Link
                href="/admin/courses"
                className="inline-flex rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
              >
                Courses
              </Link>
              <Link
                href="/admin/news"
                className="inline-flex rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
              >
                News
              </Link>
            </nav>
            <form action={logoutAction}>
              <button
                type="submit"
                className="inline-flex rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
              >
                Logout
              </button>
            </form>
          </div>
        </div>
      </header>

      <div className="space-y-6">{children}</div>
    </div>
  );
}
