// 商业机会 REST API —— 单条端点：GET 详情、PATCH 局部更新、DELETE 删除
import { NextResponse } from "next/server";
import { getOpportunity, updateOpportunity, deleteOpportunity } from "@/lib/opportunities";
import { validateOpportunity } from "@/lib/opportunities-shared";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** 只接受正整数 id，其余一律视为非法请求 */
function parseId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function badRequest(errors: Record<string, string>) {
  return NextResponse.json({ ok: false, errors }, { status: 400 });
}

function serverError(action: string, error: unknown) {
  console.error(`[api/opportunities] ${action} failed:`, error);
  return NextResponse.json(
    {
      ok: false,
      errors: { form: "数据库操作失败" },
      // 详情只进服务端日志，响应不回传（防信息泄露）
    },
    { status: 500 }
  );
}

/** GET /api/opportunities/:id */
export async function GET(_request: Request, { params }: Ctx) {
  const { id: idRaw } = await params;
  const id = parseId(idRaw);
  if (id === null) return badRequest({ id: "无效的机会 ID" });

  try {
    const item = await getOpportunity(id);
    if (!item) {
      return NextResponse.json({ ok: false, errors: { form: "机会不存在" } }, { status: 404 });
    }
    return NextResponse.json({ ok: true, item });
  } catch (error) {
    console.error("[api] 数据库操作失败:", error instanceof Error ? error.message : error);
    return serverError("GET", error);
  }
}

/** PATCH /api/opportunities/:id —— 局部更新，只写提交的字段 */
export async function PATCH(request: Request, { params }: Ctx) {
  const { id: idRaw } = await params;
  const id = parseId(idRaw);
  if (id === null) return badRequest({ id: "无效的机会 ID" });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest({ form: "请求体不是合法 JSON" });
  }

  const result = validateOpportunity(body, "update");
  if (!result.ok) {
    return badRequest(result.errors as Record<string, string>);
  }

  try {
    const item = await updateOpportunity(id, result.patch);
    if (!item) {
      return NextResponse.json({ ok: false, errors: { form: "机会不存在" } }, { status: 404 });
    }
    return NextResponse.json({ ok: true, item });
  } catch (error) {
    console.error("[api] 数据库操作失败:", error instanceof Error ? error.message : error);
    return serverError("PATCH", error);
  }
}

/** DELETE /api/opportunities/:id */
export async function DELETE(_request: Request, { params }: Ctx) {
  const { id: idRaw } = await params;
  const id = parseId(idRaw);
  if (id === null) return badRequest({ id: "无效的机会 ID" });

  try {
    const deleted = await deleteOpportunity(id);
    if (!deleted) {
      return NextResponse.json({ ok: false, errors: { form: "机会不存在" } }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[api] 数据库操作失败:", error instanceof Error ? error.message : error);
    return serverError("DELETE", error);
  }
}
