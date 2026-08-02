import Link from 'next/link';
import { getOperationsContext, todayMacau } from '@/lib/operations/context';
import { Metric, PageHeader, Panel, EmptyState } from '@/components/operations-ui';

export default async function DashboardPage() {
  const { supabase, organizationId } = await getOperationsContext();
  const today = todayMacau();
  const monthStart = `${today.slice(0, 7)}-01T00:00:00+08:00`;
  const dayStart = `${today}T00:00:00+08:00`;
  const dayEnd = `${today}T23:59:59+08:00`;
  const [sessions, attendance, leaves, makeups, ledgers, charges, payments, bookings, campuses, teachers, courses, students, cohorts, lessonPlans, futureSessions] = await Promise.all([
    supabase.from('lesson_sessions').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).gte('starts_at', dayStart).lt('starts_at', dayEnd),
    supabase.from('attendance_records').select('status').eq('organization_id', organizationId).gte('recorded_at', dayStart).lt('recorded_at', dayEnd),
    supabase.from('leave_requests').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('status', 'pending'),
    supabase.from('makeup_entitlements').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('status', 'available'),
    supabase.from('credit_ledger').select('student_package_id,delta_units').eq('organization_id', organizationId),
    supabase.from('charges').select('amount_minor,status,payment_allocations(amount_minor)').eq('organization_id', organizationId).in('status', ['open', 'partially_paid']),
    supabase.from('payments').select('amount_minor').eq('organization_id', organizationId).eq('status', 'received').gte('received_at', monthStart),
    supabase.from('bookings').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('status', 'pending'),
    supabase.from('campuses').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('is_active', true),
    supabase.from('teacher_profiles').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('is_active', true),
    supabase.from('courses').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('is_active', true),
    supabase.from('students').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('status', 'active'),
    supabase.from('exam_cohorts').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).in('status', ['draft', 'active']),
    supabase.from('lesson_plans').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId),
    supabase.from('lesson_sessions').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).gte('starts_at', new Date().toISOString())
  ]);
  const present = (attendance.data ?? []).filter(row => row.status === 'present' || row.status === 'makeup_completed').length;
  const absent = (attendance.data ?? []).filter(row => row.status === 'absent').length;
  const packageBalances = new Map<string, number>();
  for (const row of ledgers.data ?? []) packageBalances.set(String(row.student_package_id), (packageBalances.get(String(row.student_package_id)) ?? 0) + Number(row.delta_units));
  const lowCredits = Array.from(packageBalances.values()).filter(balance => balance > 0 && balance <= 2).length;
  const exhaustedCredits = Array.from(packageBalances.values()).filter(balance => balance <= 0).length;
  const overdueMinor = (charges.data ?? []).reduce((total, row: any) => total + Math.max(0, Number(row.amount_minor) - (row.payment_allocations ?? []).reduce((paid: number, allocation: any) => paid + Number(allocation.amount_minor), 0)), 0);
  const monthlyIncome = (payments.data ?? []).reduce((total, row) => total + Number(row.amount_minor || 0), 0);
  const results = [sessions, attendance, leaves, makeups, ledgers, charges, payments, bookings, campuses, teachers, courses, students, cohorts, lessonPlans, futureSessions];
  const onboarding = [
    { label: '建立第一個校區', href: '/admin/settings#campus-settings', ready: (campuses.count ?? 0) > 0 },
    { label: '連結導師登入帳戶', href: '/admin/teachers', ready: (teachers.count ?? 0) > 0 },
    { label: '建立課程', href: '/admin/courses', ready: (courses.count ?? 0) > 0 },
    { label: '建立班別及學生', href: '/admin/exam-cohorts', ready: (cohorts.count ?? 0) > 0 && (students.count ?? 0) > 0 },
    { label: '建立教案及未來課堂', href: '/admin/exam-cohorts', ready: (lessonPlans.count ?? 0) > 0 && (futureSessions.count ?? 0) > 0 }
  ];

  return <>
    <PageHeader title="營運儀表板" description="所有數字均來自目前機構的實時資料庫查詢。"/>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label="今日課堂" value={sessions.count ?? 0}/>
      <Metric label="今日出席" value={present}/>
      <Metric label="今日缺席" value={absent}/>
      <Metric label="待處理請假" value={leaves.count ?? 0}/>
      <Metric label="待安排補課" value={makeups.count ?? 0}/>
      <Metric label="即將用完堂數" value={lowCredits}/>
      <Metric label="已用完堂數" value={exhaustedCredits}/>
      <Metric label="欠費總額" value={`MOP ${(overdueMinor / 100).toFixed(2)}`}/>
      <Metric label="本月收款" value={`MOP ${(monthlyIncome / 100).toFixed(2)}`}/>
      <Metric label="未處理招生查詢" value={bookings.count ?? 0}/>
    </div>
    <div className="mt-6 grid gap-5 lg:grid-cols-2">
      <Panel title="今日優先處理"><div className="grid gap-2">{
        [['開始點名', '/admin/attendance'], ['處理請假與補課', '/admin/leave-makeup'], ['檢視待收款項', '/admin/payments'], ['完成家長跟進', '/admin/follow-ups']].map(([label, href]) =>
          <Link key={href} href={href} className="rounded-xl border p-3 text-sm font-medium hover:border-teal-400 hover:bg-teal-50">{label}</Link>)
      }</div></Panel>
      <Panel title="開始營運"><div className="grid gap-2">
        {onboarding.map((item, index) => <Link key={item.href + item.label} href={item.href} className={`flex items-center justify-between rounded-xl border p-3 text-sm ${item.ready ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'hover:border-teal-400 hover:bg-teal-50'}`}><span>{index + 1}. {item.label}</span><span aria-label={item.ready ? '已完成' : '待完成'}>{item.ready ? '已完成' : '開始'}</span></Link>)}
      </div></Panel>
      <Panel title="系統狀態"><EmptyState>{results.some(result => result.error) ? '部分統計暫時未能讀取，請稍後再試或聯絡系統管理員。' : '資料已同步至最新狀態。'}</EmptyState></Panel>
    </div>
  </>;
}
