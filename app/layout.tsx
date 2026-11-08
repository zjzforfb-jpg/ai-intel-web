import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";
import { MobileNav } from "@/components/MobileNav";

export const metadata: Metadata = {
  title: "每日 AI 情报内参 | DAILY AI INTELLIGENCE",
  description: "每日自动采集、生成与展示 AI 行业情报报告",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // 布局不再查库：数据源状态与「最近更新」由 TopBar 客户端轮询 /api/health 获取。
  //
  // 为什么：以前这里 await getStats()，导致整棵路由树被 force-dynamic 钉死，
  // 页面无法使用 revalidate；每次跳转多一次查询；构建期还会触库（DB 未起时 build 失败）。
  // 解耦后布局本身可缓存，个别页面按需 revalidate，状态反而更实时。
  const displayTz = process.env.DISPLAY_TZ || "Asia/Shanghai";

  return (
    <html lang="zh-CN" className="h-full">
      <body className="min-h-full">
        <div className="flex min-h-screen">
          <Sidebar />
          <div className="flex-1 flex flex-col min-w-0">
            <TopBar displayTz={displayTz} />
            <MobileNav />
            {/* 使用文档滚动而非内部滚动容器，保证锚点跳转、吸顶目录与阅读进度行为一致 */}
            <main className="flex-1 min-w-0">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
