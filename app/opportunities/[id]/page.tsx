import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Clock,
  Tag,
} from "lucide-react";
import {
  getOpportunity,
  getOpportunityFacets,
  getSourceReportBrief,
  type OpportunityRow,
} from "@/lib/opportunities";
import { formatDateTime } from "@/lib/format";
import { isDraftNotes } from "@/lib/opportunity-draft";
import { DbErrorState } from "@/components/DbErrorState";
import { StatusBadge } from "@/components/opportunities/StatusBadge";
import { StatusControl } from "@/components/opportunities/StatusControl";
import { EditOpportunitySection } from "@/components/opportunities/EditOpportunitySection";
import { DeleteOpportunityButton } from "@/components/opportunities/DeleteOpportunityButton";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

type SourceState =
  | { kind: "none" }
  | { kind: "found"; title: string }
  | { kind: "missing" }
  | { kind: "error" };

function SectionCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="glass-card p-5">
      <h2 className="text-[13px] font-medium text-[var(--color-text-muted)] tracking-wider mb-3">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** 可编辑长文本区块：空值给出友好占位，长 URL 强制断行防溢出 */
function TextBlock({ text, placeholder }: { text: string | null; placeholder: string }) {
  if (!text) {
    return <p className="text-[13px] text-[var(--color-text-muted)]">{placeholder}</p>;
  }
  return (
    <p className="text-[14px] leading-relaxed text-[var(--color-text-secondary)] whitespace-pre-wrap [overflow-wrap:anywhere]">
      {text}
    </p>
  );
}

export default async function OpportunityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idRaw } = await params;

  // 只接受正整数 id，非法值直接 404
  if (!/^\d+$/.test(idRaw)) notFound();
  const id = Number(idRaw);
  if (!Number.isSafeInteger(id) || id <= 0) notFound();

  let item: OpportunityRow | null = null;
  let dbError: string | null = null;
  try {
    item = await getOpportunity(id);
  } catch (error) {
    dbError = error instanceof Error ? error.message : "数据库查询失败（未知错误）";
  }

  if (dbError) {
    return (
      <DbErrorState
        title="无法读取机会详情"
        detail={dbError}
        hint={`可检查：Docker 中 n8n-radar-postgres 是否在运行、127.0.0.1:${process.env.DB_PORT ?? "5433"} 是否可连、数据库账号凭据是否有效。`}
      />
    );
  }
  if (!item) notFound();

  // 来源日报是软引用：可能已不存在，查询失败也不阻塞详情展示
  let sourceState: SourceState = { kind: "none" };
  if (item.source_report_date) {
    try {
      const brief = await getSourceReportBrief(item.source_report_date);
      sourceState = brief ? { kind: "found", title: brief.title } : { kind: "missing" };
    } catch {
      sourceState = { kind: "error" };
    }
  }

  let knownCategories: string[] = [];
  try {
    const facets = await getOpportunityFacets({});
    knownCategories = facets.categories.map((c) => c.category);
    if (item.category && !knownCategories.includes(item.category)) {
      knownCategories = [item.category, ...knownCategories];
    }
  } catch {
    // 分类提示仅是输入辅助，查询失败可忽略
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-5 flex flex-col gap-4">
      {/* 返回 */}
      <Link
        href="/opportunities"
        className="inline-flex items-center gap-1.5 text-[13px] text-[var(--color-text-muted)] hover:text-[var(--color-accent-light)] transition-colors self-start"
      >
        <ArrowLeft size={14} />
        返回机会列表
      </Link>

      {/* 页头 */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-[22px] lg:text-[24px] font-bold text-[var(--color-text-primary)] leading-snug min-w-0 [overflow-wrap:anywhere]">
              {item.title}
            </h1>
            <StatusBadge status={item.status} />
            {item.category && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-bg-card)] text-[13px] text-[var(--color-text-secondary)]">
                <Tag size={11} />
                {item.category}
              </span>
            )}
          </div>
          <p className="text-[13px] text-[var(--color-text-muted)] flex items-center gap-3 flex-wrap mt-2">
            <span className="inline-flex items-center gap-1.5">
              <Clock size={13} />
              创建于 {formatDateTime(item.created_at)}
            </span>
            <span>更新于 {formatDateTime(item.updated_at)}</span>
          </p>
        </div>
      </div>

      {/* 编辑入口（展开后为完整表单） */}
      <EditOpportunitySection item={item} knownCategories={knownCategories} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        {/* 左：正文信息 */}
        <div className="lg:col-span-2 flex flex-col gap-4 min-w-0">
          <SectionCard title="机会描述">
            <TextBlock text={item.description} placeholder="暂无描述，可点「编辑信息」补充。" />
          </SectionCard>

          {/* 自动草稿的 notes 承载判断依据，标题随之区分 */}
          <SectionCard title={isDraftNotes(item.notes) ? "判断依据（AI 草稿）" : "备注"}>
            <TextBlock text={item.notes} placeholder="暂无备注，可点「编辑信息」记录研究进展与想法。" />
          </SectionCard>

          <SectionCard title="行动计划">
            <TextBlock text={item.action_plan} placeholder="暂无行动计划，可点「编辑信息」拆解下一步动作。" />
          </SectionCard>
        </div>

        {/* 右：状态、来源、操作 */}
        <div className="flex flex-col gap-4 min-w-0">
          <SectionCard title="状态管理">
            <StatusControl id={item.id} current={item.status} key={item.status} />
            <p className="text-[13px] text-[var(--color-text-muted)] mt-3 leading-relaxed">
              四种状态可随时切换：待研究 → 验证中 → 已实施（或已放弃）。
            </p>
          </SectionCard>

          <SectionCard title="来源日报">
            {sourceState.kind === "none" ? (
              <p className="text-[13px] text-[var(--color-text-muted)]">
                未关联来源日报，可在「编辑信息」中补充来源日报日期。
              </p>
            ) : (
              <div className="flex flex-col gap-1.5">
                <div className="inline-flex items-center gap-1.5 text-[13px] text-[var(--color-text-muted)] tabular-nums">
                  <CalendarDays size={13} />
                  {item.source_report_date}
                </div>
                {sourceState.kind === "found" ? (
                  <Link
                    href={`/report/${item.source_report_date}`}
                    className="group min-w-0"
                  >
                    <div className="text-[14px] text-[var(--color-link)] group-hover:underline [overflow-wrap:anywhere]">
                      {sourceState.title}
                    </div>
                    <div className="inline-flex items-center gap-1.5 text-[13px] text-[var(--color-text-muted)] group-hover:text-[var(--color-accent-light)] transition-colors mt-1">
                      查看完整日报
                      <ArrowRight size={14} />
                    </div>
                  </Link>
                ) : sourceState.kind === "missing" ? (
                  <p className="text-[13px] text-[var(--color-text-muted)]">来源日报已不可用</p>
                ) : (
                  <p className="text-[13px] text-[var(--color-text-muted)]">
                    来源日报查询失败，请稍后重试。
                  </p>
                )}
              </div>
            )}
          </SectionCard>

          <SectionCard title="操作">
            <DeleteOpportunityButton id={item.id} title={item.title} />
            <p className="text-[13px] text-[var(--color-text-muted)] mt-3 leading-relaxed">
              删除后不可恢复；修改信息请用上方「编辑信息」。
            </p>
          </SectionCard>
        </div>
      </div>

      {/* 阅读辅助 */}
      <p className="text-[13px] text-[var(--color-text-muted)]">机会编号 #{item.id}</p>
    </div>
  );
}
