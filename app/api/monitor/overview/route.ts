// 监控 REST API —— 运行状态总览：GET /api/monitor/overview
// 只暴露必要信息：错误响应为通用文案，详情仅记录到服务端 console
import { NextResponse } from "next/server";
import { getMonitorOverview } from "@/lib/monitor/store";

export const dynamic = "force-dynamic";

/** GET /api/monitor/overview → { ok, overview } */
export async function GET() {
  try {
    const overview = await getMonitorOverview();
    return NextResponse.json({ ok: true, overview });
  } catch (error) {
    console.error("[api/monitor/overview] 查询失败:", error);
    return NextResponse.json(
      { ok: false, error: "监控数据查询失败，请稍后重试" },
      { status: 500 }
    );
  }
}
