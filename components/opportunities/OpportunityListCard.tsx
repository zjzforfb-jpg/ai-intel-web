import Link from "next/link";
import { ArrowRight, CalendarDays, Tag } from "lucide-react";
import { StatusBadge } from "./StatusBadge";
import type { OpportunityRow } from "@/lib/opportunities-shared";

interface OpportunityListCardProps {
  item: OpportunityRow;
}

/** 列表卡片：标题 + 状态徽章 + 分类 + 来源日期 + 备注摘要 */
export function OpportunityListCard({ item }: OpportunityListCardProps) {
  // 摘要优先取备注，备注为空时退化到机会描述
  const excerpt = item.notes ?? item.description;

  return (
    <Link
      href={`/opportunities/${item.id}`}
      className="block glass-card p-5 group hover:border-[var(--color-border-glow)] min-w-0"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-[16px] font-semibold text-[var(--color-text-primary)] group-hover:text-[var(--color-accent-light)] transition-colors leading-snug min-w-0 [overflow-wrap:anywhere]">
          {item.title}
        </h3>
        <StatusBadge status={item.status} className="shrink-0" />
      </div>

      <div className="flex items-center gap-x-3 gap-y-1.5 mt-2.5 flex-wrap text-[13px] text-[var(--color-text-muted)]">
        {item.category && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-bg-card)] text-[var(--color-text-secondary)]">
            <Tag size={11} />
            {item.category}
          </span>
        )}
        {item.source_report_date && (
          <span className="inline-flex items-center gap-1.5 tabular-nums">
            <CalendarDays size={13} />
            来源 {item.source_report_date}
          </span>
        )}
      </div>

      {excerpt && (
        <p className="mt-2 text-[13px] leading-relaxed text-[var(--color-text-muted)] line-clamp-2 [overflow-wrap:anywhere]">
          {excerpt}
        </p>
      )}

      <div className="flex items-center gap-1.5 mt-3 text-[13px] text-[var(--color-text-muted)] group-hover:text-[var(--color-accent-light)] transition-colors">
        查看详情
        <ArrowRight size={14} />
      </div>
    </Link>
  );
}
