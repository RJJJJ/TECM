import { createServerSupabaseClient } from '@/lib/supabase/server';

type Teacher = {
  id: string;
  user_id: string;
  display_name: string;
  phone: string | null;
  is_active: boolean;
};

export default async function TeachersPage() {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from('teacher_profiles')
    .select('id,user_id,display_name,phone,is_active')
    .order('display_name');

  const teachers = (data ?? []) as Teacher[];

  return (
    <section className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">Teacher Profiles</h2>
        <p className="mt-1 text-sm text-slate-600">
          Teachers use Supabase Auth through the iOS app, but they are not staff_roles and do not receive admin-web access.
        </p>
      </div>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error.message}</div>
      ) : teachers.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-600">
          No teacher profiles found.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">User ID</th>
                <th className="px-4 py-3">Active</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {teachers.map((teacher) => (
                <tr key={teacher.id}>
                  <td className="px-4 py-3 font-medium">{teacher.display_name}</td>
                  <td className="px-4 py-3">{teacher.phone ?? '-'}</td>
                  <td className="px-4 py-3 font-mono text-xs">{teacher.user_id}</td>
                  <td className="px-4 py-3">{teacher.is_active ? 'Yes' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
