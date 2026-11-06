// 内容项目 REST API —— 单条端点：GET 详情（含来源）、PATCH 编辑策划
//
// 依据：docs/phase3-stageB-interface.md §5
// 红线：PATCH 只接受契约 §5 白名单字段；source_idea_id / source_report_date 不可改（400）。
import { NextResponse } from "next/server";
import {
  getContentProject,
  getSourceIdea,
  getSourceReportBrief,
} from "@/lib/content-projects";
import { updateContentProject } from "@/lib/content-projects-write";
import { validateProjectPatch } from "@/lib/content-projects-shared";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function parseId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function badRequest(errors: Record<string, string>) {
  return NextResponse.json({ ok: false, errors }, { status: 400 });
}

function notFound() {
  return NextResponse.json({ ok: false, errors: { form: "内容项目不存在" } }, { status: 404 });
}

function serverError(action: string, error: unknown) {
  console.error(`[api/content-projects/:id] ${action} failed:`, error);
  return NextResponse.json({ ok: false, errors: { form: "数据库操作失败" } }, { status: 500 });
}

/** GET /api/content-projects/:id —— 项目全字段 + 来源选题原文 + 来源日报 */
export async function GET(_request: Request, { params }: Ctx) {
  const { id: idRaw } = await params;
  const id = parseId(idRaw);
  if (id === null) return badRequest({ id: "无效的内容项目 ID" });

  try {
    const item = await getContentProject(id);
    if (!item) return notFound();

    // 来源是软引用：查询失败不阻塞详情，按缺失处理
    const [sourceIdea, sourceReport] = await Promise.all([
      getSourceIdea(item.source_idea_id).catch(() => null),
      getSourceReportBrief(item.source_report_date).catch(() => null),
    ]);

    return NextResponse.json({ ok: true, item, sourceIdea, sourceReport });
  } catch (error) {
    return serverError("GET", error);
  }
}

/** PATCH /api/content-projects/:id —— 局部更新策划字段 */
export async function PATCH(request: Request, { params }: Ctx) {
  const { id: idRaw } = await params;
  const id = parseId(idRaw);
  if (id === null) return badRequest({ id: "无效的内容项目 ID" });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest({ form: "请求体不是合法 JSON" });
  }

  const result = validateProjectPatch(body);
  if (!result.ok) return badRequest(result.errors);

  try {
    const item = await updateContentProject(id, result.patch);
    if (!item) return notFound();
    return NextResponse.json({ ok: true, item });
  } catch (error) {
    return serverError("PATCH", error);
  }
}
