import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { entitiesHref, type EntityHrefParams } from "./entity-links";

interface EntityPaginationProps {
  page: number;
  total: number;
  size: number;
  /** 当前筛选条件（q / types / days），拼进每一页链接 */
  query: EntityHrefParams;
}

/** 页码窗口：当前页 ±2，含首末页 */
function pageWindow(page: number, totalPages: number): number[] {
  const pages = new Set<number>([1, totalPages, page]);
  for (let p = page - 2; p <= page + 2; p += 1) {
    if (p >= 1 && p <= totalPages) pages.add(p);
  }
  return Array.from(pages).sort((a, b) => a - b);
}

const btnBase =
  "inline-flex items-center gap-1 px-3 h-9 rounded-lg text-[13px] transition-all border border-[var(--color-border-subtle)]";
const btnActive =
  "bg-[var(--color-bg-card)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-glow)] hover:text-[var(--color-text-primary)]";
const btnDisabled = "text-[var(--color-text-muted)] opacity-50";

/** 实体列表分页（服务端链接分页，不一次拉全量） */
export function EntityPagination({ page, total, size, query }: EntityPaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / size));
  if (totalPages <= 1) return null;

  const pages = pageWindow(page, totalPages);

  return (
    <nav aria-label="分页" className="flex items-center justify-center gap-1.5 flex-wrap">
      {page > 1 ? (
        <Link href={entitiesHref({ ...query, page: page - 1 })} className={`${btnBase} ${btnActive}`}>
          <ChevronLeft size={14} />
          上一页
        </Link>
      ) : (
        <span className={`${btnBase} ${btnDisabled}`}>
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
              href={entitiesHref({ ...query, page: p })}
              className="inline-flex items-center justify-center min-w-9 h-9 px-2.5 rounded-lg bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] text-[13px] text-[var(--color-text-secondary)] hover:border-[var(--color-border-glow)] hover:text-[var(--color-text-primary)] transition-all"
            >
              {p}
            </Link>
          )}
        </span>
      ))}

      {page < totalPages ? (
        <Link href={entitiesHref({ ...query, page: page + 1 })} className={`${btnBase} ${btnActive}`}>
          下一页
          <ChevronRight size={14} />
        </Link>
      ) : (
        <span className={`${btnBase} ${btnDisabled}`}>
          下一页
          <ChevronRight size={14} />
        </span>
      )}
    </nav>
  );
}
