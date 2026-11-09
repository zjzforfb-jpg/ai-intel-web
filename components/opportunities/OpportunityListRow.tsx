import Link from "next/link";
import { ArrowRight, CalendarDays, Sparkles, Tag } from "lucide-react";
import { StatusBadge } from "./StatusBadge";
import type { OpportunityRow } from "@/lib/opportunities-shared";
import { isDraftNotes } from "@/lib/opportunity-draft";

interface OpportunityListRowProps {
  item: OpportunityRow;
}

/**
 * 商机列表行（列表流形态，非卡片）。
 * 三列卡片墙 → 横向行：标题与摘要占主区，状态/分类/日期在副行，
 * 行尾箭头指示可点。整行仍是链接，交互不变。
 */
export function OpportunityListRow({ item }: OpportunityListRowProps) {
  // 摘要优先取备注（自动草稿的备注即判断依据），备注为空时退化到机会描述
  const excerpt = item.notes ?? item.description;
  const isDraft = isDraftNotes(item.notes);

  return (
    <Link
      href={`/opportunities/${item.id}`}
      className="group flex items-start gap-3 py-3 px-3 -mx-3 rounded-lg border-b border-[var(--color-border-subtle)] last:border-b-0 transition-colors hover:bg-[var(--color-bg-card-hover)]"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2.5">
          <h3 className="text-[14px] font-semibold text-[var(--color-text-primary)] group-hover:text-[var(--color-accent-light)] transition-colors leading-snug min-w-0 [overflow-wrap:anywhere]">
            {item.title}
          </h3>
          <StatusBadge status={item.status} className="shrink-0" />
        </div>

        <div className="flex items-center gap-x-3 gap-y-1.5 mt-1.5 flex-wrap text-[11px] text-[var(--color-text-muted)]">
          {item.category && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)]">
              <Tag size={10} />
              {item.category}
            </span>
          )}
          {item.source_report_date && (
            <span className="inline-flex items-center gap-1 tabular-nums">
              <CalendarDays size={11} />
              来源 {item.source_report_date}
            </span>
          )}
          {isDraft && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-[var(--color-border-subtle)] text-[var(--color-accent-light)]">
              <Sparkles size={10} />
              AI 草稿
            </span>
          )}
        </div>

        {excerpt && (
          <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--color-text-muted)] line-clamp-2 [overflow-wrap:anywhere]">
            {excerpt}
          </p>
        )}
      </div>

      <span className="shrink-0 self-center hidden sm:inline-flex items-center gap-1 text-[12px] text-[var(--color-text-muted)] group-hover:text-[var(--color-accent-light)] transition-colors">
        详情
        <ArrowRight size={13} />
      </span>
    </Link>
  );
}
