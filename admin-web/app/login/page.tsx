export default function LoginPage() {
  return (
    <section className="mx-auto max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-xl font-semibold text-slate-900">Admin Login</h1>
      <p className="mt-2 text-sm text-slate-600">
        Step 1 僅建立頁面骨架。Step 2 會加入 email/password 登入流程。
      </p>
      <form className="mt-6 space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Email</label>
          <input
            type="email"
            placeholder="admin@tecm.com"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-slate-300 focus:ring"
            disabled
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Password</label>
          <input
            type="password"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-slate-300 focus:ring"
            disabled
          />
        </div>
        <button
          type="button"
          disabled
          className="w-full cursor-not-allowed rounded-lg bg-slate-300 px-4 py-2 text-sm font-medium text-slate-600"
        >
          Login (Step 2)
        </button>
      </form>
    </section>
  );
}
