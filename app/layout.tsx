import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: '面谈 · 面试评估工作台',
  description:
    '记录线下面试对话，校对文字，基于岗位标准和对话证据梳理面试结论。',
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
