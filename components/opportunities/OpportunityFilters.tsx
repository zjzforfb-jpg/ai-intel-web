"use client";

import { useRouter } from "next/navigation";
import { useTransition, type CSSProperties } from "react";
import { Eraser, Filter } from "lucide-react";
import {
  OPPORTUNITY_STATUSES,
  STATUS_COLOR_VAR_NAME,
  buildOpportunityQuery,
  type OpportunityStatus,
} from "@/lib/opportunities-shared";

interface OpportunityFiltersProps {
  /** 全部机会数（不受筛选影响） */
  total: number;
  /** 各状态数量（随分类筛选收窄） */
  statusCounts: Record<OpportunityStatus, number>;
  /** 真实存在的分类及数量（随状态筛选收窄） */
  categories: Array<{ category: string; count: number }>;
  currentStatus: OpportunityStatus | "";
  currentCategory: string;
}

/**
 * 筛选控件：状态筛选 + 分类筛选，条件写入 URL query（?status=&category=）
 * 条件变化自动回到第 1 页；刷新 / 前进后退 / 分享链接均可恢复。
 */
export function OpportunityFilters({
  total,
  statusCounts,
  categories,
  currentStatus,
  currentCategory,
}: OpportunityFiltersProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function apply(next: { status?: string; category?: string }) {
    const query = buildOpportunityQuery({
      status: next.status ?? currentStatus,
      category: next.category ?? currentCategory,
    });
    startTransition(() => {
      router.push(`/opportunities${query}`);
    });
  }

  function handleClear() {
    startTransition(() => {
      router.push("/opportunities");
    });
  }

  const hasFilter = !!(currentStatus || currentCategory);

  return (
    <div className="flex flex-col gap-3">
      {/* 状态筛选 */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--color-text-muted)] mr-1">
          <Filter size={12} />
          状态
        </span>

        <button
          type="button"
          onClick={() => apply({ status: "" })}
          disabled={isPending}
          aria-pressed={!currentStatus}
          className={`chip disabled:opacity-60 ${!currentStatus ? "chip-active" : ""}`}
        >
          全部
          <span className="tabular-nums opacity-70 ml-1">{total}</span>
        </button>

        {OPPORTUNITY_STATUSES.map((s) => {
          const active = currentStatus === s;
          return (
            <button
              key={s}
              type="button"
              onClick={() => apply({ status: s })}
              disabled={isPending}
              aria-pressed={active}
              className={`chip disabled:opacity-60 ${active ? "chip-active" : ""}`}
            >
              <span
                className="w-1.5 h-1.5 rounded-full mr-1.5"
                style={
                  {
                    background: active
                      ? "var(--color-on-accent)"
                      : `var(${STATUS_COLOR_VAR_NAME[s]})`,
                  } as CSSProperties
                }
                aria-hidden
              />
              {s}
              <span className="tabular-nums opacity-70 ml-1">{statusCounts[s]}</span>
            </button>
          );
        })}
      </div>

      {/* 分类筛选 + 清除 */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[12px] text-[var(--color-text-muted)] mr-1">分类</span>
        <select
          value={currentCategory}
          onChange={(e) => apply({ category: e.target.value })}
          disabled={isPending}
          aria-label="分类筛选"
          className="h-8 px-2.5 rounded-lg bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] text-[13px] text-[var(--color-text-secondary)] focus:outline-none focus:border-[var(--color-border-glow)] max-w-[15rem]"
        >
          <option value="">全部分类</option>
          {categories.map((c) => (
            <option key={c.category} value={c.category}>
              {c.category}（{c.count}）
            </option>
          ))}
          {currentCategory && !categories.some((c) => c.category === currentCategory) && (
            <option value={currentCategory}>{currentCategory}（0）</option>
          )}
        </select>

        {hasFilter && (
          <button
            type="button"
            onClick={handleClear}
            disabled={isPending}
            className="btn-secondary h-8 disabled:opacity-60"
          >
            <Eraser size={13} />
            清除筛选
          </button>
        )}
      </div>
    </div>
  );
}
