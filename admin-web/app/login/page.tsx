import LoginForm from './login-form';

export default async function LoginPage({
  searchParams
}: {
  searchParams?: Promise<{ error?: string }>;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;

  return (
    <section className="mx-auto my-10 max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-xl font-semibold text-slate-900">營運後台登入</h1>
      <p className="mt-2 text-sm text-slate-600">請使用中心管理員、職員或老師帳號登入。</p>

      {resolvedSearchParams?.error === 'unauthorized' ? (
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          你沒有後台權限，請重新登入。
        </p>
      ) : null}

      <LoginForm />
    </section>
  );
}
