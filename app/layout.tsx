import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";
import { MobileNav } from "@/components/MobileNav";
import { getStats } from "@/lib/db";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = {
  title: "每日 AI 情报内参 | DAILY AI INTELLIGENCE",
  description: "每日自动采集、生成与展示 AI 行业情报报告",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // 顶部状态栏只做一次轻量统计查询，失败时降级为「连接异常」，不影响页面主体
  let dbOk = false;
  let latestGeneratedAt: string | null = null;
  try {
    const stats = await getStats();
    dbOk = true;
    latestGeneratedAt = stats.latest_generated_at
      ? formatDateTime(stats.latest_generated_at)
      : null;
  } catch {
    dbOk = false;
  }

  const displayTz = process.env.DISPLAY_TZ || "Asia/Shanghai";

  return (
    <html lang="zh-CN" className="h-full">
      <body className="min-h-full">
        <div className="flex min-h-screen">
          <Sidebar />
          <div className="flex-1 flex flex-col min-w-0">
            <TopBar
              dbOk={dbOk}
              latestGeneratedAt={latestGeneratedAt}
              displayTz={displayTz}
            />
            <MobileNav />
            {/* 使用文档滚动而非内部滚动容器，保证锚点跳转、吸顶目录与阅读进度行为一致 */}
            <main className="flex-1 min-w-0">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
