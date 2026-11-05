import { Target } from "lucide-react";
import type { OpportunityItem } from "@/lib/markdown-parser";

interface OpportunityCardProps {
  item: OpportunityItem;
}

/** 机会卡片：图标 + 大标题 + 来源/方向/价值，字号 15–18px */
export function OpportunityCard({ item }: OpportunityCardProps) {
  return (
    <article className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-card)]/60 p-4 lg:p-5 hover:border-[var(--color-border-glow)] transition-colors">
      <div className="flex items-start gap-3 mb-3">
        <div className="shrink-0 w-9 h-9 rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 flex items-center justify-center">
          <Target size={18} />
        </div>
        <h4 className="text-[17px] lg:text-[18px] font-semibold text-[var(--color-text-primary)] leading-snug flex-1 pt-1">
          {item.title}
        </h4>
      </div>
      <div className="space-y-2 pl-12">
        {item.source && (
          <p className="text-[15px] text-[var(--color-text-muted)] leading-relaxed">
            <span className="text-[var(--color-text-secondary)] font-medium">机会来源：</span>
            {item.source}
          </p>
        )}
        {item.direction && (
          <p className="text-[15px] text-[var(--color-text-muted)] leading-relaxed">
            <span className="text-[var(--color-text-secondary)] font-medium">实现方向：</span>
            {item.direction}
          </p>
        )}
        {item.value && (
          <p className="text-[15px] text-[var(--color-text-muted)] leading-relaxed">
            <span className="text-[var(--color-text-secondary)] font-medium">潜在价值：</span>
            {item.value}
          </p>
        )}
      </div>
    </article>
  );
}
