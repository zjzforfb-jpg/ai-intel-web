// 状态筛选 —— Owner: Agent C（纯链接实现，筛选进 URL query）
import Link from "next/link";
import type { CheckStatus } from "@/lib/monitor/types";

const FILTERS: Array<{ value: CheckStatus | ""; label: string }> = [
  { value: "", label: "全部" },
  { value: "ok", label: "ok" },
  { value: "warn", label: "warn" },
  { value: "error", label: "error" },
];

/** 状态筛选栏：切换后回到第 1 页，筛选条件写入 URL */
export function RunFilter({ status }: { status: CheckStatus | "" }) {
  return (
    <nav aria-label="按结论筛选" className="flex items-center gap-2 flex-wrap">
      {FILTERS.map((f) => {
        const active = f.value === status;
        return (
          <Link
            key={f.value || "all"}
            href={f.value ? `/monitor?status=${f.value}` : "/monitor"}
            aria-current={active ? "page" : undefined}
            className={`inline-flex items-center px-3.5 h-8 rounded-lg text-[13px] transition-all border ${
              active
                ? "bg-[var(--color-accent)] border-[var(--color-accent)] text-white font-medium"
                : "bg-[var(--color-bg-card)] border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-glow)] hover:text-[var(--color-text-primary)]"
            }`}
          >
            {f.label}
          </Link>
        );
      })}
    </nav>
  );
}
