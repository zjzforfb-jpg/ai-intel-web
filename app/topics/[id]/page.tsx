import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  FileText,
  Hash,
  Pencil,
  Radar,
} from "lucide-react";
import {
  getKeywordStats,
  getRelatedReports,
  getTopicById,
} from "@/lib/topics";
import { buildSnippet } from "@/lib/search";
import { formatDateTime } from "@/lib/format";
import { CategoryBadge } from "@/components/topics/CategoryBadge";
import { KeywordChips } from "@/components/topics/KeywordChips";
import { DeleteTopicButton } from "@/components/topics/DeleteTopicButton";
import { SearchSnippet } from "@/components/history/SearchSnippet";
import { DbErrorState } from "@/components/DbErrorState";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

export default async function TopicDetailPage({ params }: { params: Params }) {
  const { id: idRaw } = await params;
  // 只接受纯数字 id，非法值直接 404（不把非法值传给数据库）
  if (!/^\d+$/.test(idRaw)) notFound();
  const id = Number(idRaw);
  if (!Number.isSafeInteger(id) || id <= 0) notFound();

  let topic: Awaited<ReturnType<typeof getTopicById>> | null = null;
  let stats: Awaited<ReturnType<typeof getKeywordStats>> = [];
  let related: Awaited<ReturnType<typeof getRelatedReports>> = { total: 0, items: [] };
  let dbError: string | null = null;

  try {
    topic = await getTopicById(id);
    if (topic) {
      [stats, related] = await Promise.all([
        getKeywordStats(topic.keywords),
        getRelatedReports(topic.keywords),
      ]);
    }
  } catch (error) {
    dbError = error instanceof Error ? error.message : "数据库查询失败（未知错误）";
  }

  if (dbError) return <DbErrorState title="无法读取专题" detail={dbError} />;
  if (!topic) notFound();

  const maxHits = stats.reduce((m, s) => Math.max(m, s.hits), 0);

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-5 flex flex-col gap-4">
      {/* 页头 */}
      <div>
        <Link
          href="/topics"
          className="inline-flex items-center gap-1.5 text-[13px] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
        >
          <ArrowLeft size={14} />
          返回专题列表
        </Link>
        <div className="flex items-start justify-between gap-4 mt-2 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-[22px] lg:text-[24px] font-bold text-[var(--color-text-primary)] break-words">
                {topic.name}
              </h1>
              <CategoryBadge category={topic.category} />
            </div>
            <p className="text-[13px] text-[var(--color-text-muted)] flex items-center gap-3 flex-wrap mt-1.5">
              <span className="inline-flex items-center gap-1.5">
                <CalendarClock size={13} />
                创建于 {formatDateTime(topic.created_at)}
              </span>
              <span>更新于 {formatDateTime(topic.updated_at)}</span>
            </p>
          </div>
          <div className="flex items-center gap-2" data-print-hide>
            <Link
              href={`/topics/${topic.id}/edit`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-card)] px-3.5 py-2 text-[13px] text-[var(--color-text-secondary)] hover:border-[var(--color-border-glow)] transition-all"
            >
              <Pencil size={15} />
              编辑
            </Link>
            <DeleteTopicButton topicId={topic.id} topicName={topic.name} />
          </div>
        </div>
      </div>

      {/* 描述 */}
      {topic.description && (
        <div className="glass-card p-5">
          <h2 className="text-[15px] font-semibold text-[var(--color-text-primary)] mb-2">专题描述</h2>
          <p className="text-[13px] leading-relaxed text-[var(--color-text-secondary)] break-words whitespace-pre-wrap">
            {topic.description}
          </p>
        </div>
      )}

      {/* 关键词与出现频次 */}
      <div className="glass-card p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-[15px] font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
            <Hash size={16} className="text-[var(--color-accent-light)]" />
            关键词与出现频次
          </h2>
          <span className="text-[13px] text-[var(--color-text-muted)]">
            同时命中全部关键词的日报共{" "}
            <span className="text-[var(--color-text-secondary)] font-medium tabular-nums">
              {related.total}
            </span>{" "}
            篇
          </span>
        </div>

        {topic.keywords.length === 0 ? (
          <div>
            <p className="text-[13px] text-[var(--color-text-muted)]">
              该专题还没有关键词，添加关键词后可自动关联历史日报。
            </p>
            <Link
              href={`/topics/${topic.id}/edit`}
              className="inline-flex items-center gap-1.5 mt-3 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-card)] px-3.5 py-2 text-[13px] text-[var(--color-text-secondary)] hover:border-[var(--color-border-glow)] transition-all"
            >
              <Pencil size={14} />
              去添加关键词
            </Link>
          </div>
        ) : (
          <>
            <KeywordChips keywords={topic.keywords} />
            <div className="flex flex-col gap-2.5">
              {stats.map((s) => (
                <div key={s.keyword} className="flex items-center gap-3 min-w-0">
                  <span className="w-32 shrink-0 text-[13px] text-[var(--color-text-secondary)] break-all">
                    {s.keyword}
                  </span>
                  <div className="flex-1 min-w-0 h-2 rounded-full bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-blue-400"
                      style={{ width: `${maxHits > 0 ? Math.max((s.hits / maxHits) * 100, s.hits > 0 ? 4 : 0) : 0}%` }}
                    />
                  </div>
                  <span className="shrink-0 w-20 text-right text-[13px] text-[var(--color-text-muted)] tabular-nums">
                    命中 {s.hits} 篇
                  </span>
                </div>
              ))}
            </div>
            <p className="text-[13px] text-[var(--color-text-muted)]">
              频次 = 单个关键词在标题或正文中出现的日报篇数；相关日报取所有关键词同时命中的交集。
            </p>
          </>
        )}
      </div>

      {/* 相关日报 */}
      <div className="glass-card p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-[15px] font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
            <FileText size={16} className="text-[var(--color-accent-light)]" />
            相关日报
          </h2>
          {topic.keywords.length > 0 && (
            <span className="text-[13px] text-[var(--color-text-muted)]">
              命中{" "}
              <span className="text-[var(--color-text-secondary)] font-medium tabular-nums">
                {related.total}
              </span>{" "}
              篇
              {related.total > related.items.length && `，显示最近 ${related.items.length} 篇`}
            </span>
          )}
        </div>

        {topic.keywords.length === 0 ? (
          <p className="text-[13px] text-[var(--color-text-muted)]">
            添加关键词后，这里会列出同时命中全部关键词的历史日报。
          </p>
        ) : related.items.length > 0 ? (
          <div className="flex flex-col gap-3">
            {related.items.map((report) => {
              const matched = topic!.keywords.filter(
                (k) => report.title_hits.includes(k) || report.body_hits.includes(k)
              );
              const snippet = buildSnippet(report.report_markdown, topic!.keywords);
              return (
                <Link
                  key={report.id}
                  href={`/report/${report.report_date}`}
                  className="block rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-card)] p-4 sm:p-5 group hover:border-[var(--color-border-glow)] transition-colors min-w-0"
                >
                  <div className="flex items-start gap-4">
                    {/* 日期块 */}
                    <div className="shrink-0 w-[4.5rem] text-center rounded-lg bg-[var(--color-bg-panel)] border border-[var(--color-border-subtle)] py-2">
                      <div className="text-[15px] font-bold text-[var(--color-text-primary)] tabular-nums leading-none">
                        {report.report_date.slice(8, 10)}
                      </div>
                      <div className="text-[13px] text-[var(--color-text-muted)] tabular-nums mt-1">
                        {report.report_date.slice(0, 7)}
                      </div>
                    </div>

                    <div className="min-w-0 flex-1">
                      <h3 className="text-[15px] font-semibold text-[var(--color-text-primary)] group-hover:text-[var(--color-accent-light)] transition-colors leading-snug break-words">
                        {report.title}
                      </h3>

                      {snippet && <SearchSnippet segments={snippet} />}

                      <div className="mt-2.5">
                        <div className="text-[13px] text-[var(--color-text-muted)] mb-1">
                          命中词（高亮为标题命中）
                        </div>
                        <KeywordChips keywords={matched} titleHits={report.title_hits} />
                      </div>

                      <div className="flex items-center gap-x-4 gap-y-1 mt-2 text-[13px] text-[var(--color-text-muted)] flex-wrap">
                        <span>生成 {formatDateTime(report.generated_at)}</span>
                        {report.total_articles !== null && (
                          <span>
                            收录文章{" "}
                            <span className="text-[var(--color-text-secondary)] tabular-nums">
                              {report.total_articles}
                            </span>
                          </span>
                        )}
                        {report.status && (
                          <span className={report.status === "success" ? "text-green-400" : "text-amber-400"}>
                            {report.status === "success" ? "已生成" : report.status}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="shrink-0 self-center hidden sm:flex items-center gap-1.5 text-[13px] text-[var(--color-text-muted)] group-hover:text-[var(--color-accent-light)] transition-colors">
                      查看完整报告
                      <ArrowRight size={15} />
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-card)] p-8 text-center">
            <Radar size={26} className="text-[var(--color-text-muted)] mx-auto mb-3" />
            <p className="text-[13px] text-[var(--color-text-secondary)] mb-1">
              暂无相关日报：当前关键词组合还没有同时命中任何一篇日报
            </p>
            <p className="text-[13px] text-[var(--color-text-muted)]">
              可以在编辑页调整关键词，或等待新的日报生成后再来查看。
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
