import type { OpportunityItem } from "@/lib/markdown-parser";

interface OpportunityCardProps {
  item: OpportunityItem;
}

/** 机会条目：标题 + 来源/方向/价值。外层 SectionPanel 已承载卡片。 */
export function OpportunityCard({ item }: OpportunityCardProps) {
  return (
    <article className="border-b border-[var(--color-border-subtle)] last:border-b-0 pb-3 last:pb-0">
      <div className="flex items-start gap-2.5 mb-1.5">
        <span
          className="shrink-0 w-1.5 h-1.5 rounded-full mt-2"
          style={{ background: "var(--color-zone-opportunity)" }}
          aria-hidden
        />
        <h4 className="text-[14px] font-semibold text-[var(--color-text-primary)] leading-snug flex-1 min-w-0 [overflow-wrap:anywhere]">
          {item.title}
        </h4>
      </div>
      <div className="flex flex-col gap-1 pl-[16px]">
        {item.source && (
          <p className="text-[13px] text-[var(--color-text-muted)] leading-relaxed [overflow-wrap:anywhere]">
            <span className="text-[var(--color-text-secondary)] font-medium">机会来源：</span>
            {item.source}
          </p>
        )}
        {item.direction && (
          <p className="text-[13px] text-[var(--color-text-muted)] leading-relaxed [overflow-wrap:anywhere]">
            <span className="text-[var(--color-text-secondary)] font-medium">实现方向：</span>
            {item.direction}
          </p>
        )}
        {item.value && (
          <p className="text-[13px] text-[var(--color-text-muted)] leading-relaxed [overflow-wrap:anywhere]">
            <span className="text-[var(--color-text-secondary)] font-medium">潜在价值：</span>
            {item.value}
          </p>
        )}
      </div>
    </article>
  );
}
