import Link from "next/link";
import { Layers, Plus, Tags } from "lucide-react";
import { listTopics, getCategoryCounts, isTopicCategory, TOPIC_CATEGORIES } from "@/lib/topics";
import type { TopicCategory } from "@/lib/db-write";
import { TopicCard } from "@/components/topics/TopicCard";
import { DbErrorState } from "@/components/DbErrorState";
import { PageHeader, PageBody } from "@/components/PageHeader";

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
    <PageBody>
      <PageHeader
        title="专题追踪"
        subtitle={
          <>
            <span className="inline-flex items-center gap-1.5">
              <Tags size={13} />
              共
              <span className="text-[var(--color-text-secondary)] font-medium tabular-nums">
                {totalCount}
              </span>
              个专题
            </span>
            <span>用关键词把相关历史日报聚合成一条持续追踪线</span>
          </>
        }
        actions={
          <Link href="/topics/new" className="btn-primary">
            <Plus size={14} />
            创建专题
          </Link>
        }
      />

      {/* 分类筛选 */}
      <div className="flex items-center gap-2 flex-wrap">
        <Link
          href="/topics"
          className={`chip ${category === null ? "chip-active" : ""}`}
        >
          全部 <span className="tabular-nums opacity-70 ml-1">{totalCount}</span>
        </Link>
        {TOPIC_CATEGORIES.map((c) => (
          <Link
            key={c}
            href={`/topics?category=${encodeURIComponent(c)}`}
            className={`chip ${category === c ? "chip-active" : ""}`}
          >
            {c} <span className="tabular-nums opacity-70 ml-1">{counts[c]}</span>
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
        <div className="empty-state">
          <Layers size={26} className="text-[var(--color-text-muted)]" />
          {category !== null ? (
            <>
              <p className="text-[14px] text-[var(--color-text-secondary)]">
                「{category}」分类下还没有专题
              </p>
              <p className="text-[13px] text-[var(--color-text-muted)]">
                换一个分类看看，或创建一个新的{category}专题。
              </p>
            </>
          ) : (
            <>
              <p className="text-[14px] text-[var(--color-text-secondary)]">还没有专题</p>
              <p className="text-[13px] text-[var(--color-text-muted)]">
                点击右上角「创建专题」，用关键词把相关历史日报聚合成一条追踪线。
              </p>
            </>
          )}
          <Link href="/topics/new" className="btn-primary mt-1">
            <Plus size={14} />
            创建专题
          </Link>
        </div>
      )}
    </PageBody>
  );
}
