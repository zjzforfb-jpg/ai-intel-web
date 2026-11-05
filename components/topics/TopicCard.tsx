import Link from "next/link";
import { ArrowRight, FileText, Pencil, Layers } from "lucide-react";
import type { TopicWithCount } from "@/lib/topics";
import { formatDateTime } from "@/lib/format";
import { CategoryBadge } from "./CategoryBadge";
import { KeywordChips } from "./KeywordChips";
import { DeleteTopicButton } from "./DeleteTopicButton";

/** 专题卡片（列表页）：名称、分类、关键词、相关日报数、编辑/删除 */
export function TopicCard({ topic }: { topic: TopicWithCount }) {
  return (
    <div className="glass-card p-5 flex flex-col gap-3 min-w-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/topics/${topic.id}`}
            className="text-[17px] font-semibold text-[var(--color-text-primary)] hover:text-[var(--color-accent-light)] transition-colors break-words"
          >
            {topic.name}
          </Link>
          <div className="flex items-center gap-2 mt-1.5 text-[13px] text-[var(--color-text-muted)] flex-wrap">
            <span className="inline-flex items-center gap-1.5">
              <FileText size={13} />
              相关日报{" "}
              <span className="text-[var(--color-text-secondary)] tabular-nums font-medium">
                {topic.related_count}
              </span>{" "}
              篇
            </span>
            <span>更新于 {formatDateTime(topic.updated_at)}</span>
          </div>
        </div>
        <CategoryBadge category={topic.category} />
      </div>

      {topic.description && (
        <p className="text-[13px] leading-relaxed text-[var(--color-text-secondary)] break-words line-clamp-2">
          {topic.description}
        </p>
      )}

      {topic.keywords.length > 0 ? (
        <KeywordChips keywords={topic.keywords} />
      ) : (
        <p className="inline-flex items-center gap-1.5 text-[13px] text-[var(--color-text-muted)]">
          <Layers size={13} />
          还没有关键词，添加后可自动关联历史日报
        </p>
      )}

      <div className="flex items-center justify-between gap-3 pt-1 mt-auto flex-wrap">
        <Link
          href={`/topics/${topic.id}`}
          className="inline-flex items-center gap-1.5 text-[13px] text-[var(--color-accent-light)] hover:opacity-80 transition-opacity"
        >
          查看详情
          <ArrowRight size={14} />
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href={`/topics/${topic.id}/edit`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-card)] px-2.5 py-1.5 text-[13px] text-[var(--color-text-secondary)] hover:border-[var(--color-border-glow)] transition-all"
          >
            <Pencil size={14} />
            编辑
          </Link>
          <DeleteTopicButton topicId={topic.id} topicName={topic.name} size="sm" />
        </div>
      </div>
    </div>
  );
}
