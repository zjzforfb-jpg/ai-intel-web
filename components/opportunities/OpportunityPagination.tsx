import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { buildOpportunityQuery } from "@/lib/opportunities-shared";

interface OpportunityPaginationProps {
  page: number;
  totalPages: number;
  /** 当前生效的状态/分类筛选 */
  baseQuery: { status?: string; category?: string };
}

/** 计算页码窗口：当前页 ±2，含首末页 */
function pageWindow(page: number, totalPages: number): number[] {
  const pages = new Set<number>([1, totalPages, page]);
  for (let p = page - 2; p <= page + 2; p++) {
    if (p >= 1 && p <= totalPages) pages.add(p);
  }
  return Array.from(pages).sort((a, b) => a - b);
}

function hrefFor(baseQuery: { status?: string; category?: string }, page: number): string {
  return `/opportunities${buildOpportunityQuery({ ...baseQuery, page })}`;
}

/** /opportunities 分页（保留状态与分类筛选条件） */
export function OpportunityPagination({ page, totalPages, baseQuery }: OpportunityPaginationProps) {
  if (totalPages <= 1) return null;

  const pages = pageWindow(page, totalPages);

  return (
    <nav aria-label="分页" className="flex items-center justify-center gap-1.5 flex-wrap">
      {page > 1 ? (
        <Link
          href={hrefFor(baseQuery, page - 1)}
          className="inline-flex items-center gap-1 px-3 h-9 rounded-lg bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] text-[13px] text-[var(--color-text-secondary)] hover:border-[var(--color-border-glow)] hover:text-[var(--color-text-primary)] transition-all"
        >
          <ChevronLeft size={14} />
          上一页
        </Link>
      ) : (
        <span className="inline-flex items-center gap-1 px-3 h-9 rounded-lg border border-[var(--color-border-subtle)] text-[13px] text-[var(--color-text-muted)] opacity-50">
          <ChevronLeft size={14} />
          上一页
        </span>
      )}

      {pages.map((p, idx) => (
        <span key={p} className="inline-flex items-center">
          {idx > 0 && p - pages[idx - 1] > 1 && (
            <span className="px-1 text-[var(--color-text-muted)]">…</span>
          )}
          {p === page ? (
            <span
              aria-current="page"
              className="inline-flex items-center justify-center min-w-9 h-9 px-2.5 rounded-lg bg-[var(--color-accent)] text-white text-[13px] font-medium"
            >
              {p}
            </span>
          ) : (
            <Link
              href={hrefFor(baseQuery, p)}
              className="inline-flex items-center justify-center min-w-9 h-9 px-2.5 rounded-lg bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] text-[13px] text-[var(--color-text-secondary)] hover:border-[var(--color-border-glow)] hover:text-[var(--color-text-primary)] transition-all"
            >
              {p}
            </Link>
          )}
        </span>
      ))}

      {page < totalPages ? (
        <Link
          href={hrefFor(baseQuery, page + 1)}
          className="inline-flex items-center gap-1 px-3 h-9 rounded-lg bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] text-[13px] text-[var(--color-text-secondary)] hover:border-[var(--color-border-glow)] hover:text-[var(--color-text-primary)] transition-all"
        >
          下一页
          <ChevronRight size={14} />
        </Link>
      ) : (
        <span className="inline-flex items-center gap-1 px-3 h-9 rounded-lg border border-[var(--color-border-subtle)] text-[13px] text-[var(--color-text-muted)] opacity-50">
          下一页
          <ChevronRight size={14} />
        </span>
      )}
    </nav>
  );
}
