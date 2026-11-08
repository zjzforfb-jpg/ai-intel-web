// 健康探针 —— 供顶栏显示「数据源已连接/异常」与「最近更新时间」
//
// 为什么要有这个端点：
// 之前这些信息由 app/layout.tsx 在服务端 await getStats() 注入，代价是
//   1) 整个布局被 force-dynamic 钉死，所有页面都无法缓存；
//   2) 每次页面跳转都多一次 DB 查询；
//   3) 构建期触库，DB 未起时 npm run build 会失败。
// 改成客户端轻量轮询后，布局可以静态化，状态反而更实时。
//
// 约定：
// - 永不缓存（no-store），否则顶栏会显示过期的连接状态；
// - DB 不可用时返回 200 + ok:false，而不是 5xx —— 这是状态查询，不是错误，
//   让前端能区分「DB 挂了」和「接口本身挂了」。
import { NextResponse } from "next/server";
import { getStats } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const stats = await getStats();
    return NextResponse.json(
      {
        ok: true,
        db: "postgresql",
        latestReportDate: stats.latest_date,
        latestGeneratedAt: stats.latest_generated_at,
        totalReports: stats.total_reports,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        db: "postgresql",
        error: error instanceof Error ? error.message.slice(0, 120) : "unknown",
        latestGeneratedAt: null,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
}
