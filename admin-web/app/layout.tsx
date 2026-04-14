import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'TECM Admin Web',
  description: 'TECM booking management admin web'
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant">
      <body>
        <div className="min-h-screen">
          <header className="border-b border-slate-200 bg-white">
            <div className="mx-auto flex h-14 max-w-6xl items-center px-4">
              <p className="text-sm font-semibold tracking-wide text-slate-700">
                TECM Admin Web
              </p>
            </div>
          </header>
          <main className="mx-auto w-full max-w-6xl px-4 py-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
