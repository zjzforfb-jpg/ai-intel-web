import type { TrendItem } from "@/lib/markdown-parser";

interface TrendCardProps {
  item: TrendItem;
}

/** 趋势卡片：序号 + 大标题 + 依据/观点，字号 15–18px */
export function TrendCard({ item }: TrendCardProps) {
  return (
    <article className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-card)]/60 p-4 lg:p-5 hover:border-[var(--color-border-glow)] transition-colors">
      <div className="flex items-start gap-3 mb-2.5">
        <span className="shrink-0 text-sm font-bold text-purple-400 tabular-nums mt-1">
          {String(item.index).padStart(2, "0")}
        </span>
        <h4 className="text-[17px] lg:text-[18px] font-semibold text-[var(--color-text-primary)] leading-snug">
          {item.title}
        </h4>
      </div>
      {item.basis && (
        <p className="text-[15px] text-[var(--color-text-muted)] leading-relaxed mb-1.5 pl-8">
          <span className="text-[var(--color-text-secondary)] font-medium">依据：</span>
          {item.basis}
        </p>
      )}
      {item.viewpoint && (
        <p className="text-[15px] text-[var(--color-text-muted)] leading-relaxed pl-8">
          <span className="text-[var(--color-text-secondary)] font-medium">观点：</span>
          {item.viewpoint}
        </p>
      )}
    </article>
  );
}
