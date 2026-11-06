// 内容项目导出 —— GET /api/content-projects/:id/export
//
// 返回 production_input.json 本体（可直接下载），并置：
//   production_status='已导出待生产'、exported_at=NOW()、status='已导出'
//
// 诚实红线：本接口只生成文件内容，不写入用户磁盘、不调用 AI_DIRECTOR_PROJECT。
// 交接方式见响应中的 target_pipeline 与页面上的步骤说明。
import { NextResponse } from "next/server";
import {
  getContentProject,
  getSourceIdea,
  getSourceReportBrief,
} from "@/lib/content-projects";
import { markContentProjectExported } from "@/lib/content-projects-write";
import { buildProductionInput } from "@/lib/content-export";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function parseId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export async function GET(_request: Request, { params }: Ctx) {
  const { id: idRaw } = await params;
  const id = parseId(idRaw);
  if (id === null) {
    return NextResponse.json({ ok: false, errors: { id: "无效的内容项目 ID" } }, { status: 400 });
  }

  try {
    const project = await getContentProject(id);
    if (!project) {
      return NextResponse.json({ ok: false, errors: { form: "内容项目不存在" } }, { status: 404 });
    }

    const [sourceIdea, sourceReport] = await Promise.all([
      getSourceIdea(project.source_idea_id).catch(() => null),
      getSourceReportBrief(project.source_report_date).catch(() => null),
    ]);

    const productionInput = buildProductionInput({ project, sourceIdea, sourceReport });

    // 先落状态再返回：避免界面显示「已导出」但库里没记录
    const updated = await markContentProjectExported(id);
    if (!updated) {
      return NextResponse.json({ ok: false, errors: { form: "内容项目不存在" } }, { status: 404 });
    }

    return NextResponse.json(productionInput, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": 'attachment; filename="production_input.json"',
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[api/content-projects/:id/export] failed:", error);
    return NextResponse.json({ ok: false, errors: { form: "导出失败" } }, { status: 500 });
  }
}
