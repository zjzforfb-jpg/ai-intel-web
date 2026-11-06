import Link from "next/link";
import { ArrowUpRight, CalendarDays } from "lucide-react";
import type { EntityListItem } from "@/lib/entities";
import { EntityTypeBadge } from "./EntityTypeBadge";

interface EntityTableProps {
  items: EntityListItem[];
  /** 当前热度窗口（列头随筛选变化） */
  days: 7 | 30;
}

/** 实体列表表格：名称 / 类型 / 总提及 / 近 N 天 / 最近出现 */
export function EntityTable({ items, days }: EntityTableProps) {
  return (
    <div className="glass-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left">
          <thead>
            <tr className="border-b border-[var(--color-border-subtle)] text-[12px] text-[var(--color-text-muted)]">
              <th className="px-4 py-3 font-medium">名称</th>
              <th className="px-4 py-3 font-medium w-[110px]">类型</th>
              <th className="px-4 py-3 font-medium w-[90px] text-right">总提及</th>
              <th className="px-4 py-3 font-medium w-[90px] text-right">近 {days} 天</th>
              <th className="px-4 py-3 font-medium w-[140px]">最近出现</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                key={item.id}
                className="border-b border-[var(--color-border-subtle)] last:border-0 hover:bg-[var(--color-bg-card-hover)] transition-colors"
              >
                <td className="px-4 py-3">
                  <Link
                    href={`/entities/${item.id}`}
                    className="group inline-flex items-center gap-1.5 text-[14px] font-medium text-[var(--color-text-primary)] hover:text-[var(--color-accent-light)] transition-colors"
                  >
                    {item.name}
                    <ArrowUpRight
                      size={13}
                      className="opacity-0 group-hover:opacity-100 transition-opacity"
                    />
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <EntityTypeBadge type={item.entityType} />
                </td>
                <td className="px-4 py-3 text-right text-[14px] tabular-nums text-[var(--color-text-secondary)]">
                  {item.mentionCount}
                </td>
                <td className="px-4 py-3 text-right text-[14px] tabular-nums">
                  <span
                    className={
                      (days === 30 ? item.recent30d : item.recent7d) > 0
                        ? "text-[var(--color-accent-light)] font-medium"
                        : "text-[var(--color-text-muted)]"
                    }
                  >
                    {days === 30 ? item.recent30d : item.recent7d}
                  </span>
                </td>
                <td className="px-4 py-3 text-[13px] text-[var(--color-text-muted)] tabular-nums whitespace-nowrap">
                  {item.lastMentionDate ? (
                    <span className="inline-flex items-center gap-1.5">
                      <CalendarDays size={12} />
                      {item.lastMentionDate}
                    </span>
                  ) : (
                    "无提及"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
