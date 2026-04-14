import LoginForm from './login-form';

export default function LoginPage({
  searchParams
}: {
  searchParams?: { error?: string };
}) {
  return (
    <section className="mx-auto max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-xl font-semibold text-slate-900">Admin Login</h1>
      <p className="mt-2 text-sm text-slate-600">請使用 staff 帳號登入後台。</p>

      {searchParams?.error === 'unauthorized' ? (
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          你沒有後台權限，請重新登入。
        </p>
      ) : null}

      <LoginForm />
    </section>
  );
}
