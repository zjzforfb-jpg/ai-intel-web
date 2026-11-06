import Link from "next/link";
import { ArrowUpRight, CalendarDays, CheckCircle2 } from "lucide-react";
import type { IdeaRow } from "@/lib/ideas-shared";
import type { ReferenceMaterial } from "@/lib/content-projects-shared";

interface SourcePanelProps {
  projectId: number;
  sourceIdea: IdeaRow | null;
  sourceReportDate: string | null;
  sourceReportTitle: string | null;
  referenceMaterials: ReferenceMaterial[];
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[12px] text-[var(--color-text-muted)]">{label}</span>
      <div className="text-[13px] leading-relaxed text-[var(--color-text-secondary)] whitespace-pre-wrap [overflow-wrap:anywhere]">
        {children}
      </div>
    </div>
  );
}

/** 右侧「原始情报来源」：选题原文 / 日报链接 / 参考素材。全部只读，展示的是入库原文 */
export function SourcePanel({
  projectId,
  sourceIdea,
  sourceReportDate,
  sourceReportTitle,
  referenceMaterials,
}: SourcePanelProps) {
  return (
    <section className="glass-card p-5 flex flex-col gap-4">
      <h2 className="text-[13px] font-medium text-[var(--color-text-muted)] tracking-wider">
        原始情报来源
      </h2>

      {sourceIdea ? (
        <>
          <Field label={`选题 #${sourceIdea.id} 原文`}>
            <span className="text-[var(--color-text-primary)] font-medium">{sourceIdea.title}</span>
          </Field>
          <Field label="切入角度（angle）">
            {sourceIdea.angle || <span className="text-[var(--color-text-muted)]">未提供</span>}
          </Field>
          <Field label="素材来源（source_material）">
            {sourceIdea.source_material || (
              <span className="text-[var(--color-text-muted)]">未提供，导出文件里会标注为待核实</span>
            )}
          </Field>
          <Field label="参考画面（reference_visuals）">
            {sourceIdea.reference_visuals || (
              <span className="text-[var(--color-text-muted)]">未提供</span>
            )}
          </Field>
          <div className="flex items-center gap-3 flex-wrap text-[12px] text-[var(--color-text-muted)]">
            <span>价值评分：{sourceIdea.value_score ?? "未评分"}</span>
            <span>选题状态：{sourceIdea.status}</span>
          </div>
        </>
      ) : (
        <p className="text-[13px] text-[var(--color-text-muted)] leading-relaxed">
          {projectId > 0
            ? "来源选题已不存在（可能被删除）。项目仍可用，但原始素材无法核对。"
            : "无来源选题。"}
        </p>
      )}

      <div className="pt-3 border-t border-[var(--color-border-subtle)]">
        <Field label="来源日报">
          {sourceReportDate ? (
            <Link
              href={`/report/${sourceReportDate}`}
              className="inline-flex items-start gap-1.5 text-[var(--color-link)] hover:underline [overflow-wrap:anywhere]"
            >
              <CalendarDays size={13} className="mt-0.5 shrink-0" />
              <span>
                {sourceReportTitle ?? `日报 ${sourceReportDate}（正文已不可用）`}
                <ArrowUpRight size={12} className="inline ml-1" />
              </span>
            </Link>
          ) : (
            <span className="text-[var(--color-text-muted)]">未关联日报</span>
          )}
        </Field>
      </div>

      <div className="pt-3 border-t border-[var(--color-border-subtle)]">
        <Field label="参考素材">
          {referenceMaterials.length > 0 ? (
            <ul className="flex flex-col gap-1.5">
              {referenceMaterials.map((m, i) => (
                <li key={`${m.url ?? m.title ?? "m"}-${i}`} className="flex items-start gap-1.5">
                  <CheckCircle2 size={12} className="mt-1 shrink-0 text-[var(--color-text-muted)]" />
                  <span>
                    {m.title || m.url || "未命名素材"}
                    {m.note && (
                      <span className="text-[var(--color-text-muted)]">（{m.note}）</span>
                    )}
                    {m.url && (
                      <a
                        href={m.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="block text-[12px] text-[var(--color-link)] hover:underline [overflow-wrap:anywhere]"
                      >
                        {m.url}
                      </a>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-[var(--color-text-muted)]">暂无，建议在左侧「策划」里补充原始链接</span>
          )}
        </Field>
      </div>

      <p className="text-[12px] text-[var(--color-text-muted)] leading-relaxed pt-3 border-t border-[var(--color-border-subtle)]">
        以上内容来自入库的选题原文与日报，平台不会改写来源字段。
      </p>
    </section>
  );
}
