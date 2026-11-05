import Link from "next/link";
import { Layers, Plus, Tags } from "lucide-react";
import { listTopics, getCategoryCounts, isTopicCategory, TOPIC_CATEGORIES } from "@/lib/topics";
import type { TopicCategory } from "@/lib/db-write";
import { TopicCard } from "@/components/topics/TopicCard";
import { DbErrorState } from "@/components/DbErrorState";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

export default async function TopicsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const categoryRaw = first(sp.category);
  // 只接受四种合法分类，其余一律视为「全部」（非法值不进 SQL）
  const category: TopicCategory | null = isTopicCategory(categoryRaw) ? categoryRaw : null;

  let topics: Awaited<ReturnType<typeof listTopics>> | null = null;
  let counts: Awaited<ReturnType<typeof getCategoryCounts>> | null = null;
  let dbError: string | null = null;

  try {
    [topics, counts] = await Promise.all([listTopics(category), getCategoryCounts()]);
  } catch (error) {
    dbError = error instanceof Error ? error.message : "数据库查询失败（未知错误）";
  }

  if (dbError || !topics || !counts) {
    return <DbErrorState title="无法读取专题列表" detail={dbError} />;
  }

  const totalCount = TOPIC_CATEGORIES.reduce((sum, c) => sum + counts![c], 0);

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-5 flex flex-col gap-4">
      {/* 页头 */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[22px] lg:text-[24px] font-bold text-[var(--color-text-primary)] mb-1">
            专题追踪
          </h1>
          <p className="text-[13px] text-[var(--color-text-muted)] flex items-center gap-3 flex-wrap">
            <span className="inline-flex items-center gap-1.5">
              <Tags size={13} />
              共{" "}
              <span className="text-[var(--color-text-secondary)] font-medium tabular-nums">
                {totalCount}
              </span>{" "}
              个专题
            </span>
            <span>用关键词把相关历史日报聚合成一条持续追踪线</span>
          </p>
        </div>
        <Link
          href="/topics/new"
          className="inline-flex items-center gap-2 rounded-lg bg-[var(--color-accent)] px-4 py-2 text-[13px] text-white hover:opacity-90 transition-opacity"
        >
          <Plus size={15} />
          创建专题
        </Link>
      </div>

      {/* 分类筛选 */}
      <div className="flex items-center gap-2 flex-wrap">
        <Link
          href="/topics"
          className={`rounded-lg border px-3.5 py-1.5 text-[13px] transition-all ${
            category === null
              ? "border-[var(--color-accent)] bg-[var(--color-accent-glow)] text-[var(--color-accent-light)]"
              : "border-[var(--color-border-subtle)] bg-[var(--color-bg-card)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-glow)]"
          }`}
        >
          全部 <span className="tabular-nums">{totalCount}</span>
        </Link>
        {TOPIC_CATEGORIES.map((c) => (
          <Link
            key={c}
            href={`/topics?category=${encodeURIComponent(c)}`}
            className={`rounded-lg border px-3.5 py-1.5 text-[13px] transition-all ${
              category === c
                ? "border-[var(--color-accent)] bg-[var(--color-accent-glow)] text-[var(--color-accent-light)]"
                : "border-[var(--color-border-subtle)] bg-[var(--color-bg-card)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-glow)]"
            }`}
          >
            {c} <span className="tabular-nums">{counts[c]}</span>
          </Link>
        ))}
      </div>

      {/* 专题卡片 */}
      {topics.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4">
          {topics.map((topic) => (
            <TopicCard key={topic.id} topic={topic} />
          ))}
        </div>
      ) : (
        <div className="glass-card p-10 text-center">
          <Layers size={28} className="text-[var(--color-text-muted)] mx-auto mb-3" />
          {category !== null ? (
            <>
              <p className="text-base text-[var(--color-text-secondary)] mb-1">
                「{category}」分类下还没有专题
              </p>
              <p className="text-[13px] text-[var(--color-text-muted)]">
                换一个分类看看，或创建一个新的{category}专题。
              </p>
            </>
          ) : (
            <>
              <p className="text-base text-[var(--color-text-secondary)] mb-1">还没有专题</p>
              <p className="text-[13px] text-[var(--color-text-muted)]">
                点击右上角「创建专题」，用关键词把相关历史日报聚合成一条追踪线。
              </p>
            </>
          )}
          <Link
            href="/topics/new"
            className="inline-flex items-center gap-2 mt-5 rounded-lg bg-[var(--color-accent)] px-4 py-2 text-[13px] text-white hover:opacity-90 transition-opacity"
          >
            <Plus size={15} />
            创建专题
          </Link>
        </div>
      )}
    </div>
  );
}
