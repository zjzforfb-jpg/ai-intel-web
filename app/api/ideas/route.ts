// 选题 REST API —— 列表端点：GET 列表（date/status 筛选）、POST 新建
import { NextResponse } from "next/server";
import { listIdeas, createIdea, IdeaConflictError } from "@/lib/ideas";
import { isIdeaStatus, validateIdea } from "@/lib/ideas-shared";

export const dynamic = "force-dynamic";

function badRequest(errors: Record<string, string>) {
  return NextResponse.json({ ok: false, errors }, { status: 400 });
}

function serverError(action: string, error: unknown) {
  console.error(`[api/ideas] ${action} failed:`, error);
  return NextResponse.json(
    {
      ok: false,
      errors: { form: "数据库操作失败" },
      // 详情只进服务端日志，响应不回传（防信息泄露）
    },
    { status: 500 }
  );
}

/** GET /api/ideas?date=YYYY-MM-DD&status=待制作 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date")?.trim() || null;
  const statusRaw = url.searchParams.get("status");
  const status = isIdeaStatus(statusRaw) ? statusRaw : null;

  try {
    const items = await listIdeas({ date, status });
    return NextResponse.json({ ok: true, items });
  } catch (error) {
    console.error("[api] 数据库操作失败:", error instanceof Error ? error.message : error);
    return serverError("GET", error);
  }
}

/** POST /api/ideas —— 新建选题 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest({ form: "请求体不是合法 JSON" });
  }

  const result = validateIdea(body, "create");
  if (!result.ok) {
    return badRequest(result.errors as Record<string, string>);
  }

  try {
    const item = await createIdea(result.value);
    return NextResponse.json({ ok: true, item }, { status: 201 });
  } catch (error) {
    if (error instanceof IdeaConflictError) {
      return NextResponse.json(
        { ok: false, errors: { title: error.message } },
        { status: 409 }
      );
    }
    console.error("[api] 数据库操作失败:", error instanceof Error ? error.message : error);
    return serverError("POST", error);
  }
}
