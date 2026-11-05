"use client";

// 时间范围筛选（客户端）：近 7 天 / 近 30 天 / 自定义起止日期
// 状态写入 URL query（range/from/to），刷新、前进后退、分享均可恢复

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CalendarRange, Eraser, Check } from "lucide-react";
import type { RangeMode } from "@/lib/trends";

export interface RangeFilterState {
  mode: RangeMode;
  /** 自定义起止（YYYY-MM-DD 或空串） */
  from: string;
  to: string;
}

interface RangeFilterProps {
  initial: RangeFilterState;
  /** 数据里真实存在的日期边界（date 输入的 min/max，不造数） */
  dataEarliest: string | null;
  dataLatest: string | null;
}

const QUICK: Array<{ mode: "7d" | "30d"; label: string }> = [
  { mode: "7d", label: "近 7 天" },
  { mode: "30d", label: "近 30 天" },
];

export function RangeFilter({ initial, dataEarliest, dataLatest }: RangeFilterProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);

  function push(query: string) {
    startTransition(() => {
      router.push(query ? `/trends?${query}` : "/trends");
    });
  }

  function applyQuick(mode: "7d" | "30d") {
    push(`range=${mode}`);
  }

  function applyAll() {
    push("");
  }

  function applyCustom() {
    const sp = new URLSearchParams();
    sp.set("range", "custom");
    if (from) sp.set("from", from);
    if (to) sp.set("to", to);
    push(sp.toString());
  }

  const dateAttrs: {
    min?: string;
    max?: string;
    style: React.CSSProperties;
    className: string;
  } = {
    style: { colorScheme: "dark" },
    className:
      "h-10 px-3 rounded-lg bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] text-[14px] text-[var(--color-text-secondary)] focus:outline-none focus:border-[var(--color-border-glow)]",
  };
  if (dataEarliest) dateAttrs.min = dataEarliest;
  if (dataLatest) dateAttrs.max = dataLatest;

  return (
    <div className="glass-card p-4">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="inline-flex items-center gap-1.5 text-[13px] text-[var(--color-text-muted)] mr-1">
          <CalendarRange size={15} />
          时间范围
        </span>

        <button
          type="button"
          onClick={applyAll}
          disabled={isPending}
          className={`h-10 px-4 rounded-lg text-[14px] transition-all disabled:opacity-60 ${
            initial.mode === "all"
              ? "bg-[var(--color-accent-glow)] text-[var(--color-accent-light)] border border-[var(--color-border-glow)]"
              : "bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-glow)]"
          }`}
        >
          全部
        </button>

        {QUICK.map((q) => (
          <button
            key={q.mode}
            type="button"
            onClick={() => applyQuick(q.mode)}
            disabled={isPending}
            className={`h-10 px-4 rounded-lg text-[14px] transition-all inline-flex items-center gap-1.5 disabled:opacity-60 ${
              initial.mode === q.mode
                ? "bg-[var(--color-accent-glow)] text-[var(--color-accent-light)] border border-[var(--color-border-glow)]"
                : "bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-glow)]"
            }`}
          >
            {initial.mode === q.mode && <Check size={14} />}
            {q.label}
          </button>
        ))}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            applyCustom();
          }}
          className="flex items-center gap-2 flex-wrap"
        >
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            aria-label="开始日期"
            {...dateAttrs}
          />
          <span className="text-[13px] text-[var(--color-text-muted)]">至</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            aria-label="结束日期"
            {...dateAttrs}
          />
          <button
            type="submit"
            disabled={isPending}
            className={`h-10 px-4 rounded-lg text-[14px] transition-all inline-flex items-center gap-1.5 disabled:opacity-60 ${
              initial.mode === "custom"
                ? "bg-[var(--color-accent-glow)] text-[var(--color-accent-light)] border border-[var(--color-border-glow)]"
                : "bg-[var(--color-accent)] text-white hover:opacity-90"
            }`}
          >
            {isPending ? "应用中…" : "应用"}
          </button>
        </form>

        {(initial.mode !== "all" || from || to) && (
          <button
            type="button"
            onClick={() => {
              setFrom("");
              setTo("");
              applyAll();
            }}
            disabled={isPending}
            className="h-10 px-3.5 rounded-lg text-[14px] bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-glow)] hover:text-[var(--color-text-primary)] transition-all inline-flex items-center gap-1.5 disabled:opacity-60"
          >
            <Eraser size={14} />
            清除筛选
          </button>
        )}
      </div>
    </div>
  );
}
