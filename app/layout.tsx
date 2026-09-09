import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: '伯乐 AI · 面试评估工作台',
  description:
    '粘贴候选人简历，粘贴文本或导入 Markdown 面试记录，基于岗位标准和原文证据生成并确认结论评估。',
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
