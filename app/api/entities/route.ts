// 实体列表 API —— GET /api/entities?q=&type=&days=7|30&page=1&size=20
// 契约：docs/phase3-stageB-interface.md 第 4 节
import { NextResponse } from "next/server";
import {
  DEFAULT_PAGE_SIZE,
  listEntities,
  normalizeDays,
  normalizePaging,
  normalizeTypes,
} from "@/lib/entities";

export const dynamic = "force-dynamic";

/** 解析正整数参数；非法值回落到默认值 */
function intParam(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q");
  const typeParam = url.searchParams.get("type");
  const types = normalizeTypes(typeParam ? typeParam.split(",") : null);
  const days = normalizeDays(intParam(url.searchParams.get("days"), 7));
  const { page, size } = normalizePaging(
    intParam(url.searchParams.get("page"), 1),
    intParam(url.searchParams.get("size"), DEFAULT_PAGE_SIZE)
  );

  try {
    const result = await listEntities({ q, types, days, page, size });
    return NextResponse.json(result);
  } catch (error) {
    console.error(
      "[api/entities] 列表查询失败:",
      error instanceof Error ? error.message : error
    );
    // 数据库不可用：返回可读的空结果 + 5xx，不编造数据
    return NextResponse.json(
      { items: [], total: 0, page, size, error: "数据库查询失败" },
      { status: 500 }
    );
  }
}
