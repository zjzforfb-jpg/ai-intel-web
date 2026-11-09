import type { TrendItem } from "@/lib/markdown-parser";

interface TrendCardProps {
  item: TrendItem;
}

/** 趋势条目：序号 + 标题 + 依据/观点。外层 SectionPanel 已承载卡片。 */
export function TrendCard({ item }: TrendCardProps) {
  return (
    <article className="border-b border-[var(--color-border-subtle)] last:border-b-0 pb-3 last:pb-0">
      <div className="flex items-start gap-2.5 mb-1.5">
        <span
          className="shrink-0 text-[12px] font-bold tnum mt-0.5"
          style={{ color: "var(--color-zone-trend)" }}
        >
          {String(item.index).padStart(2, "0")}
        </span>
        <h4 className="text-[14px] font-semibold text-[var(--color-text-primary)] leading-snug min-w-0 [overflow-wrap:anywhere]">
          {item.title}
        </h4>
      </div>
      <div className="flex flex-col gap-1 pl-[30px]">
        {item.basis && (
          <p className="text-[13px] text-[var(--color-text-muted)] leading-relaxed [overflow-wrap:anywhere]">
            <span className="text-[var(--color-text-secondary)] font-medium">依据：</span>
            {item.basis}
          </p>
        )}
        {item.viewpoint && (
          <p className="text-[13px] text-[var(--color-text-muted)] leading-relaxed [overflow-wrap:anywhere]">
            <span className="text-[var(--color-text-secondary)] font-medium">观点：</span>
            {item.viewpoint}
          </p>
        )}
      </div>
    </article>
  );
}
