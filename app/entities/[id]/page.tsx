import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  ExternalLink,
  Globe,
  Layers,
  Tag,
} from "lucide-react";
import { getEntityDetail } from "@/lib/entities";
import { formatDateTime } from "@/lib/format";
import { DbErrorState } from "@/components/DbErrorState";
import { StatCard } from "@/components/StatCard";
import { EntityTypeBadge } from "@/components/entities/EntityTypeBadge";
import { DataSufficiencyNotice } from "@/components/entities/DataSufficiencyNotice";
import { MentionTimeline } from "@/components/entities/MentionTimeline";
import { dbHint } from "@/lib/config";

// 实体详情是纯阅读页（无写操作、无写后回显）。
// 实体提及由 n8n 每天 08:30 更新一次，缓存 5 分钟足够。
export const revalidate = 300;

// 动态段必须显式声明 generateStaticParams 才会走「按需生成 + ISR」；
// 返回空数组 ⇒ 不预生成任何 id，首次访问时生成并缓存，新实体无需重新构建。
export function generateStaticParams(): Array<{ id: string }> {
  return [];
}

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

export default async function EntityDetailPage({ params }: PageProps) {
  const { id: idRaw } = await params;

  // 只接受正整数 id，非法值直接 404
  if (!/^\d+$/.test(idRaw)) notFound();
  const id = Number(idRaw);
  if (!Number.isSafeInteger(id) || id <= 0) notFound();

  let detail: Awaited<ReturnType<typeof getEntityDetail>> = null;
  let dbError: string | null = null;
  try {
    detail = await getEntityDetail(id);
  } catch (error) {
    dbError = error instanceof Error ? error.message : "数据库查询失败（未知错误）";
  }

  if (dbError) {
    return (
      <DbErrorState
        title="无法读取实体详情"
        detail={dbError}
        hint={dbHint("reader")}
      />
    );
  }
  if (!detail) notFound();

  const { entity, stats, mentions, relatedIdeas, relatedOpportunities } = detail;

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-5 flex flex-col gap-4">
      <Link
        href="/entities"
        className="inline-flex items-center gap-1.5 text-[13px] text-[var(--color-text-muted)] hover:text-[var(--color-accent-light)] transition-colors self-start"
      >
        <ArrowLeft size={14} />
        返回实体列表
      </Link>

      {/* 页头 */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-[22px] lg:text-[24px] font-bold text-[var(--color-text-primary)] leading-snug min-w-0 [overflow-wrap:anywhere]">
              {entity.name}
            </h1>
            <EntityTypeBadge type={entity.entityType} />
            {entity.entityType === "unknown" && (
              <span className="text-[12px] text-[var(--color-text-muted)]">
                类型待人工确认
              </span>
            )}
          </div>

          {entity.aliases.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap mt-2">
              <Tag size={12} className="text-[var(--color-text-muted)]" />
              {entity.aliases.map((alias) => (
                <span
                  key={alias}
                  className="px-2 py-0.5 rounded-md bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] text-[12px] text-[var(--color-text-secondary)]"
                >
                  {alias}
                </span>
              ))}
            </div>
          )}

          <p className="text-[13px] text-[var(--color-text-muted)] flex items-center gap-3 flex-wrap mt-2">
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays size={13} />
              {stats.firstMentionDate ?? "—"} ~ {stats.lastMentionDate ?? "—"}
            </span>
            <span>归一化名 {entity.normalizedName}</span>
            <span>更新于 {formatDateTime(entity.updatedAt)}</span>
          </p>
        </div>
      </div>

      {/* 统计卡 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="总提及" value={stats.mentionCount} icon="articles" accent="indigo" />
        <StatCard label="近 7 天" value={stats.recent7d} icon="headlines" accent="blue" />
        <StatCard label="近 30 天" value={stats.recent30d} icon="trends" accent="purple" />
        <StatCard label="覆盖日报日期" value={stats.distinctMentionDays} icon="opportunities" accent="emerald" />
      </div>

      {/* 数据不足时不得输出趋势结论 */}
      {!stats.dataSufficient && (
        <DataSufficiencyNotice
          mentionCount={stats.mentionCount}
          distinctMentionDays={stats.distinctMentionDays}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        {/* 左：提及时间线 */}
        <div className="lg:col-span-2 min-w-0">
          <SectionCard title="提及时间线（按日报倒序）">
            <MentionTimeline mentions={mentions} />
          </SectionCard>
        </div>

        {/* 右：实体信息 + 关联选题 + 关联商机 */}
        <div className="flex flex-col gap-4 min-w-0">
          <SectionCard title="实体信息">
            <dl className="flex flex-col gap-2.5 text-[13px]">
              <div>
                <dt className="text-[var(--color-text-muted)] mb-0.5">简介</dt>
                <dd className="text-[var(--color-text-secondary)] leading-relaxed whitespace-pre-wrap">
                  {entity.description ?? "暂无简介（人工维护字段，自动流程不会覆盖）"}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--color-text-muted)] mb-0.5">官网</dt>
                <dd>
                  {entity.website ? (
                    <a
                      href={entity.website}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1.5 text-[var(--color-link)] hover:underline [overflow-wrap:anywhere]"
                    >
                      <Globe size={12} />
                      {entity.website}
                      <ExternalLink size={11} />
                    </a>
                  ) : (
                    <span className="text-[var(--color-text-muted)]">暂无</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--color-text-muted)] mb-0.5">实体编号</dt>
                <dd className="tabular-nums text-[var(--color-text-secondary)]">#{entity.id}</dd>
              </div>
            </dl>
          </SectionCard>

          <SectionCard title="关联选题">
            {relatedIdeas.length === 0 ? (
              <p className="text-[13px] text-[var(--color-text-muted)]">
                暂无关联选题（按「提及日期 = 选题来源日报日期」匹配）。
              </p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {relatedIdeas.map((idea) => (
                  <li key={idea.id} className="min-w-0">
                    <p className="text-[13px] text-[var(--color-text-secondary)] leading-snug [overflow-wrap:anywhere]">
                      {idea.title}
                    </p>
                    <Link
                      href={`/report/${idea.reportDate}`}
                      className="inline-flex items-center gap-1 text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-accent-light)] transition-colors tabular-nums"
                    >
                      {idea.reportDate}
                      <ArrowRight size={11} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard title="关联商机">
            {relatedOpportunities.length === 0 ? (
              <p className="text-[13px] text-[var(--color-text-muted)]">
                暂无关联商机（按「提及日期 = 商机来源日报日期」匹配）。
              </p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {relatedOpportunities.map((opp) => (
                  <li key={opp.id} className="min-w-0">
                    <Link
                      href={`/opportunities/${opp.id}`}
                      className="text-[13px] text-[var(--color-text-secondary)] leading-snug hover:text-[var(--color-link)] transition-colors [overflow-wrap:anywhere]"
                    >
                      {opp.title}
                    </Link>
                    <p className="text-[12px] text-[var(--color-text-muted)] tabular-nums">
                      {opp.sourceReportDate ?? "来源日期不详"}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <div className="inline-flex items-center gap-1.5 text-[12px] text-[var(--color-text-muted)]">
            <Layers size={12} />
            数据来源：日报头条抽取（受控词典，零模型调用）
          </div>
        </div>
      </div>
    </div>
  );
}
