// 内容项目 REST API —— 列表端点：GET 列表（status 筛选 + 分页）、POST 从选题创建
//
// 依据：docs/phase3-stageB-interface.md §5
import { NextResponse } from "next/server";
import { listContentProjects } from "@/lib/content-projects";
import { createContentProject, TopicIdeaNotFoundError } from "@/lib/content-projects-write";
import { isProjectStatus, validateCreateProject } from "@/lib/content-projects-shared";

export const dynamic = "force-dynamic";

function badRequest(errors: Record<string, string>) {
  return NextResponse.json({ ok: false, errors }, { status: 400 });
}

function serverError(action: string, error: unknown) {
  console.error(`[api/content-projects] ${action} failed:`, error);
  return NextResponse.json({ ok: false, errors: { form: "数据库操作失败" } }, { status: 500 });
}

/** GET /api/content-projects?status=草稿&page=1&size=20 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const statusRaw = url.searchParams.get("status");
  const status = isProjectStatus(statusRaw) ? statusRaw : null;
  const page = Number(url.searchParams.get("page") ?? "1");
  const size = Number(url.searchParams.get("size") ?? "20");

  try {
    const result = await listContentProjects({ status, page, size });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return serverError("GET", error);
  }
}

/** POST /api/content-projects —— 从选题创建（同选题幂等，不重复建） */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest({ form: "请求体不是合法 JSON" });
  }

  const result = validateCreateProject(body);
  if (!result.ok) return badRequest(result.errors);

  try {
    const { created, row } = await createContentProject(result.value);
    if (!created) {
      return NextResponse.json(
        {
          ok: false,
          errors: { form: "该选题已存在内容项目，已为你打开既有项目" },
          existingId: row.id,
          item: row,
        },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { ok: true, id: row.id, title: row.title, status: row.status, item: row },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof TopicIdeaNotFoundError) {
      return NextResponse.json(
        { ok: false, errors: { topicIdeaId: "选题不存在或已删除" } },
        { status: 404 }
      );
    }
    return serverError("POST", error);
  }
}
