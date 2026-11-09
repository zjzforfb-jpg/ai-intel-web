import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Clock } from "lucide-react";
import {
  getContentProject,
  getSourceIdea,
  getSourceReportBrief,
} from "@/lib/content-projects";
import { exportWarnings } from "@/lib/content-export";
import { importedKinds } from "@/lib/content-import";
import type { IdeaRow } from "@/lib/ideas-shared";
import type { SourceReportBrief } from "@/lib/content-projects";
import { formatDateTime } from "@/lib/format";
import { DbErrorState } from "@/components/DbErrorState";
import { ContentTypeBadge, ProductionStatusBadge, ProjectStatusBadge } from "@/components/content/Badges";
import { PlanEditor } from "@/components/content/PlanEditor";
import { ExportPanel } from "@/components/content/ExportPanel";
import { ImportPanel } from "@/components/content/ImportPanel";
import { SourcePanel } from "@/components/content/SourcePanel";
import { ProductionTimeline } from "@/components/content/ProductionTimeline";
import { dbHint } from "@/lib/config";
import { PageHeader, PageBody } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="glass-card p-5">
      <h2 className="text-[13px] font-medium text-[var(--color-text-muted)] tracking-wider mb-3">
        {title}
      </h2>
      {children}
    </section>
  );
}

function JsonPreview({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) return null;
  return (
    <details className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)]">
      <summary className="cursor-pointer px-3 py-2 text-[12px] text-[var(--color-text-secondary)]">
        {label}
      </summary>
      <pre className="max-h-60 overflow-auto px-3 pb-3 text-[11px] leading-relaxed text-[var(--color-text-muted)] font-mono">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}

export default async function ContentDetailPage({ params }: PageProps) {
  const { id: idRaw } = await params;
  if (!/^\d+$/.test(idRaw)) notFound();
  const id = Number(idRaw);
  if (!Number.isSafeInteger(id) || id <= 0) notFound();

  let project: Awaited<ReturnType<typeof getContentProject>> = null;
  let dbError: string | null = null;
  try {
    project = await getContentProject(id);
  } catch (error) {
    dbError = error instanceof Error ? error.message : "数据库查询失败（未知错误）";
  }

  if (dbError) {
    return (
      <DbErrorState
        title="无法读取内容项目"
        detail={dbError}
        hint={dbHint("any")}
      />
    );
  }
  if (!project) notFound();

  // 来源是软引用：查询失败不影响项目本身
  let sourceIdea: IdeaRow | null = null;
  let sourceReport: SourceReportBrief | null = null;
  try {
    [sourceIdea, sourceReport] = await Promise.all([
      getSourceIdea(project.source_idea_id),
      getSourceReportBrief(project.source_report_date),
    ]);
  } catch {
    sourceIdea = null;
    sourceReport = null;
  }

  const warnings = exportWarnings(project);
  const kinds = importedKinds(project);

  return (
    <PageBody>
      <PageHeader
        title={project.title}
        subtitle={
          <>
            <ProjectStatusBadge status={project.status} />
            <ContentTypeBadge type={project.content_type} />
            <ProductionStatusBadge status={project.production_status} />
            <span className="inline-flex items-center gap-1.5">
              <Clock size={13} />
              创建于 {formatDateTime(project.created_at)}
            </span>
            <span>更新于 {formatDateTime(project.updated_at)}</span>
            <span>项目编号 #{project.id}</span>
            <Link
              href="/content"
              className="inline-flex items-center gap-1 hover:text-[var(--color-accent-light)] transition-colors"
            >
              <ArrowLeft size={12} />
              返回内容中心
            </Link>
          </>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        <div className="lg:col-span-2 flex flex-col gap-4 min-w-0">
          <PlanEditor
            project={project}
            source={{
              angle: sourceIdea?.angle ?? null,
              sourceMaterial: sourceIdea?.source_material ?? null,
              referenceVisuals: sourceIdea?.reference_visuals ?? null,
            }}
          />

          <ExportPanel
            projectId={project.id}
            productionStatus={project.production_status}
            exportedAt={project.exported_at}
            warnings={warnings}
          />

          <ImportPanel projectId={project.id} productionStatus={project.production_status} />
        </div>

        <div className="flex flex-col gap-4 min-w-0">
          <SourcePanel
            projectId={project.id}
            sourceIdea={sourceIdea}
            sourceReportDate={project.source_report_date}
            sourceReportTitle={sourceReport?.title ?? null}
            referenceMaterials={project.reference_materials}
          />

          <ProductionTimeline
            current={project.production_status}
            exportedAt={project.exported_at}
            exportPath={project.export_path}
          />

          <SectionCard title="已回读的产物">
            {kinds.length === 0 ? (
              <p className="text-[13px] text-[var(--color-text-muted)] leading-relaxed">
                还没有回读任何结果。生产完成后，把脚本 / 分镜 / 质检整理成 JSON 在左侧提交。
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                <p className="text-[13px] text-[var(--color-text-secondary)]">
                  已收到：{kinds.join("、")}
                </p>
                <JsonPreview label="script_result" value={project.script_result} />
                <JsonPreview label="storyboard_result" value={project.storyboard_result} />
                <JsonPreview label="quality_check" value={project.quality_check} />
              </div>
            )}
          </SectionCard>

          <SectionCard title="内容边界">
            <ul className="flex flex-col gap-1.5 text-[12px] text-[var(--color-text-muted)] leading-relaxed">
              <li>· 来源选题与来源日报由创建时确定，任何编辑都不会改动它们。</li>
              <li>· 平台不生成事实、不补链接；未核实的信息统一放在「待核实信息」。</li>
              <li>· 导出只是生成文件，生产流程需在 AI_DIRECTOR_PROJECT 里手动执行。</li>
            </ul>
          </SectionCard>
        </div>
      </div>
    </PageBody>
  );
}
