// 实体详情 API —— GET /api/entities/[id]
// 契约：docs/phase3-stageB-interface.md 第 4 节
import { NextResponse } from "next/server";
import { getEntityDetail } from "@/lib/entities";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: idRaw } = await params;
  if (!/^\d+$/.test(idRaw)) {
    return NextResponse.json({ error: "实体不存在" }, { status: 404 });
  }
  const id = Number(idRaw);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return NextResponse.json({ error: "实体不存在" }, { status: 404 });
  }

  try {
    const detail = await getEntityDetail(id);
    if (!detail) {
      return NextResponse.json({ error: "实体不存在" }, { status: 404 });
    }
    return NextResponse.json(detail);
  } catch (error) {
    console.error(
      "[api/entities/:id] 详情查询失败:",
      error instanceof Error ? error.message : error
    );
    return NextResponse.json({ error: "数据库查询失败" }, { status: 500 });
  }
}
