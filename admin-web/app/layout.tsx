import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'TECM 教育中心營運助手',
  description: '澳門教育中心招生、點名、請假補課、堂數及收費營運系統'
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
