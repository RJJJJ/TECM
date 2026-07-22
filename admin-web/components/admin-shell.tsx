import Link from 'next/link';
import { logoutAction } from '@/app/admin/actions';

type Role = 'admin' | 'staff' | 'teacher';

const sections: ReadonlyArray<readonly [string, string, readonly Role[]]> = [
  ['總覽', '/admin/dashboard', ['admin', 'staff', 'teacher']],
  ['學生', '/admin/students', ['admin', 'staff']],
  ['家長', '/admin/guardians', ['admin', 'staff']],
  ['家長通知', '/admin/notifications', ['admin', 'staff']],
  ['導師', '/admin/teachers', ['admin', 'staff']],
  ['課程', '/admin/courses', ['admin', 'staff']],
  ['班別', '/admin/classes', ['admin', 'staff', 'teacher']],
  ['今日課堂', '/admin/sessions', ['admin', 'staff', 'teacher']],
  ['點名', '/admin/attendance', ['admin', 'staff', 'teacher']],
  ['請假與補課', '/admin/leave-makeup', ['admin', 'staff']],
  ['套票與課堂額', '/admin/packages', ['admin', 'staff']],
  ['收費與付款', '/admin/payments', ['admin', 'staff']],
  ['跟進事項', '/admin/follow-ups', ['admin', 'staff']],
  ['設定', '/admin/settings', ['admin']],
  ['審計紀錄', '/admin/audit-log', ['admin']]
];

function Navigation({ role }: { role: string }) {
  return (
    <nav className="space-y-1" aria-label="後台功能">
      {sections.filter(([, , roles]) => roles.includes(role as Role)).map(([label, href]) => (
        <Link key={href} href={href} className="block rounded-lg px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-teal-50 hover:text-teal-800">
          {label}
        </Link>
      ))}
    </nav>
  );
}

export default function AdminShell({ children, organizationName, role = 'staff' }: { children: React.ReactNode; organizationName?: string | null; role?: string }) {
  return (
    <div className="min-h-screen bg-slate-100">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur lg:hidden">
        <div className="flex min-h-16 items-center justify-between gap-3 px-4">
          <Link href="/admin/dashboard" className="font-semibold text-slate-950">TECM 教務營運</Link>
          <details className="relative">
            <summary className="cursor-pointer list-none rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium">功能選單</summary>
            <div className="absolute right-0 mt-2 max-h-[75vh] w-64 overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
              <Navigation role={role} />
              <form action={logoutAction} className="mt-3 border-t pt-3"><button className="w-full rounded-lg px-3 py-2 text-left text-sm text-rose-700">登出</button></form>
            </div>
          </details>
        </div>
      </header>
      <div className="mx-auto flex max-w-[1600px]">
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r border-slate-200 bg-white p-5 lg:block">
          <Link href="/admin/dashboard" className="block rounded-xl bg-slate-950 p-4 text-white">
            <span className="block text-xs font-semibold tracking-[0.2em] text-teal-300">TECM</span>
            <span className="mt-1 block text-lg font-semibold">教務營運後台</span>
            <span className="mt-1 block truncate text-xs text-slate-300">{organizationName || '教育中心'}</span>
          </Link>
          <div className="mt-5 h-[calc(100vh-12rem)] overflow-y-auto pr-1"><Navigation role={role} /></div>
          <form action={logoutAction} className="border-t pt-3"><button className="w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-rose-700 hover:bg-rose-50">登出</button></form>
        </aside>
        <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
