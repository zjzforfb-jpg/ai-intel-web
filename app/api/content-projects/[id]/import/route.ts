// 内容项目回读 —— POST /api/content-projects/:id/import
//
// 接收用户侧生产流程的产物（脚本 / 分镜 / 质检），写入对应 JSONB 列并推进状态。
// 依据：docs/phase3-stageB-interface.md §5
//
// 不读用户磁盘：产物需由用户或本地脚本整理为 JSON 后提交。
import { NextResponse } from "next/server";
import { getContentProject } from "@/lib/content-projects";
import {
  getProductionStatus,
  importContentProjectResults,
} from "@/lib/content-projects-write";
import { validateImport } from "@/lib/content-projects-shared";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function parseId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function notFound() {
  return NextResponse.json({ ok: false, errors: { form: "内容项目不存在" } }, { status: 404 });
}

export async function POST(request: Request, { params }: Ctx) {
  const { id: idRaw } = await params;
  const id = parseId(idRaw);
  if (id === null) {
    return NextResponse.json({ ok: false, errors: { id: "无效的内容项目 ID" } }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, errors: { form: "请求体不是合法 JSON" } }, { status: 400 });
  }

  const parsed = validateImport(body);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, errors: parsed.errors }, { status: 400 });
  }

  try {
    const project = await getContentProject(id);
    if (!project) return notFound();

    const current = (await getProductionStatus(id)) ?? project.production_status;
    const item = await importContentProjectResults(id, parsed.value, current);
    if (!item) return notFound();

    return NextResponse.json({ ok: true, item });
  } catch (error) {
    console.error("[api/content-projects/:id/import] failed:", error);
    return NextResponse.json({ ok: false, errors: { form: "回读失败" } }, { status: 500 });
  }
}
