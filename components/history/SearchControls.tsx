"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Search, X, Eraser } from "lucide-react";

export interface HistoryQueryState {
  q: string;
  from: string;
  to: string;
  year: string;
  month: string;
}

interface SearchControlsProps {
  initial: HistoryQueryState;
  /** 数据中真实存在的年份（倒序） */
  years: number[];
  /** 每个年份下真实存在的月份（倒序） */
  monthsByYear: Record<number, number[]>;
}

/** 由筛选条件构造 /history 查询串；空值不入 URL，page 仅在 >1 时出现（条件变化自动回到第 1 页） */
export function buildHistorySearch(
  state: Partial<HistoryQueryState>,
  page?: number
): URLSearchParams {
  const sp = new URLSearchParams();
  if (state.q?.trim()) sp.set("q", state.q.trim());
  if (state.from) sp.set("from", state.from);
  if (state.to) sp.set("to", state.to);
  if (state.year) sp.set("year", state.year);
  if (state.month) sp.set("month", state.month);
  if (page && page > 1) sp.set("page", String(page));
  return sp;
}

/**
 * 搜索与筛选控件（客户端）
 * - Enter 提交；日期/年月变化自动提交并重置回第 1 页
 * - 条件保存在 URL 查询参数中（刷新/前进后退/分享均可恢复）
 */
export function SearchControls({ initial, years, monthsByYear }: SearchControlsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [q, setQ] = useState(initial.q);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [year, setYear] = useState(initial.year);
  const [month, setMonth] = useState(initial.month);

  const hasCondition = !!(q.trim() || from || to || year || month);

  function apply(next: Partial<HistoryQueryState>) {
    const merged = { q, from, to, year, month, ...next };
    const sp = buildHistorySearch(merged); // 不带 page：条件变化重置到第 1 页
    startTransition(() => {
      router.push(`/history${sp.size ? `?${sp.toString()}` : ""}`);
    });
  }

  function handleClear() {
    setQ("");
    setFrom("");
    setTo("");
    setYear("");
    setMonth("");
    startTransition(() => {
      router.push("/history");
    });
  }

  // 年份变化时收窄月份选项到该年真实存在的月份
  const monthOptions = year
    ? monthsByYear[Number(year)] ?? []
    : Array.from(new Set(Object.values(monthsByYear).flat())).sort((a, b) => b - a);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        apply({ q, from, to, year, month });
      }}
      className="glass-card p-4 lg:p-5"
    >
      <div className="flex flex-col lg:flex-row gap-3">
        {/* 关键词 */}
        <div className="relative flex-1 min-w-0">
          <Search
            size={17}
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] pointer-events-none"
          />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索标题与正文，多个关键词用空格分隔（如：OpenAI 事故）"
            aria-label="搜索关键词"
            className="w-full h-11 pl-10 pr-3 rounded-lg bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] text-[15px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-border-glow)]"
          />
        </div>

        {/* 日期范围 */}
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              apply({ from: e.target.value });
            }}
            aria-label="开始日期"
            style={{ colorScheme: "dark" }}
            className="h-11 px-3 rounded-lg bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] text-[14px] text-[var(--color-text-secondary)] focus:outline-none focus:border-[var(--color-border-glow)]"
          />
          <span className="text-[var(--color-text-muted)]">至</span>
          <input
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              apply({ to: e.target.value });
            }}
            aria-label="结束日期"
            style={{ colorScheme: "dark" }}
            className="h-11 px-3 rounded-lg bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] text-[14px] text-[var(--color-text-secondary)] focus:outline-none focus:border-[var(--color-border-glow)]"
          />
        </div>

        {/* 年 / 月 */}
        <div className="flex items-center gap-2">
          <select
            value={year}
            onChange={(e) => {
              const y = e.target.value;
              setYear(y);
              setMonth("");
              apply({ year: y, month: "" });
            }}
            aria-label="年份筛选"
            className="h-11 px-3 rounded-lg bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] text-[14px] text-[var(--color-text-secondary)] focus:outline-none focus:border-[var(--color-border-glow)]"
          >
            <option value="">全部年份</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y} 年
              </option>
            ))}
          </select>
          <select
            value={month}
            onChange={(e) => {
              setMonth(e.target.value);
              apply({ month: e.target.value });
            }}
            aria-label="月份筛选"
            className="h-11 px-3 rounded-lg bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] text-[14px] text-[var(--color-text-secondary)] focus:outline-none focus:border-[var(--color-border-glow)]"
          >
            <option value="">全部月份</option>
            {monthOptions.map((m) => (
              <option key={m} value={m}>
                {m} 月
              </option>
            ))}
          </select>
        </div>

        {/* 操作 */}
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={isPending}
            className="h-11 px-5 rounded-lg bg-[var(--color-accent)] text-white text-[15px] font-medium hover:opacity-90 transition-opacity disabled:opacity-60 inline-flex items-center gap-2"
          >
            <Search size={16} />
            {isPending ? "搜索中…" : "搜索"}
          </button>
          {hasCondition && (
            <button
              type="button"
              onClick={handleClear}
              disabled={isPending}
              className="h-11 px-4 rounded-lg bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] text-[14px] hover:border-[var(--color-border-glow)] hover:text-[var(--color-text-primary)] transition-all inline-flex items-center gap-1.5"
            >
              <Eraser size={15} />
              清空
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
