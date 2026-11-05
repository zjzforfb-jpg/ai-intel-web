import { ExternalLink } from "lucide-react";
import type { HeadlineItem } from "@/lib/markdown-parser";

interface HeadlineCardProps {
  item: HeadlineItem;
}

/** 头条卡片：大标题 + 结构化字段，字号 15–18px */
export function HeadlineCard({ item }: HeadlineCardProps) {
  return (
    <article className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-card)]/60 p-4 lg:p-5 hover:border-[var(--color-border-glow)] transition-colors">
      {/* 标题行 */}
      <div className="flex items-start gap-3 mb-3">
        <span className="shrink-0 w-8 h-8 rounded-lg bg-indigo-500/15 text-indigo-300 border border-indigo-500/25 flex items-center justify-center text-sm font-bold">
          {item.index}
        </span>
        {item.link ? (
          <a
            href={item.link}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[17px] lg:text-[18px] font-semibold text-[var(--color-text-primary)] hover:text-[var(--color-link)] transition-colors flex-1 leading-snug"
          >
            {item.title}
            <ExternalLink size={14} className="inline-block ml-1.5 text-[var(--color-text-muted)]" />
          </a>
        ) : (
          <h4 className="text-[17px] lg:text-[18px] font-semibold text-[var(--color-text-primary)] flex-1 leading-snug">
            {item.title}
          </h4>
        )}
      </div>

      {/* 字段 */}
      <div className="space-y-2.5">
        {item.source && (
          <div className="flex gap-2.5">
            <span className="shrink-0 w-[4.5rem] text-[13px] leading-6 text-[var(--color-text-muted)]">来源</span>
            <span className="text-[15px] text-[var(--color-text-secondary)] leading-relaxed">{item.source}</span>
          </div>
        )}
        {item.coreFact && (
          <div className="flex gap-2.5">
            <span className="shrink-0 w-[4.5rem] text-[13px] leading-6 text-[var(--color-text-muted)]">核心事实</span>
            <span className="text-[15px] text-[var(--color-text-secondary)] leading-relaxed">{item.coreFact}</span>
          </div>
        )}
        {item.deepAnalysis && (
          <div className="flex gap-2.5">
            <span className="shrink-0 w-[4.5rem] text-[13px] leading-6 text-[var(--color-text-muted)]">深度解读</span>
            <span className="text-[15px] text-[var(--color-text-secondary)] leading-relaxed">{item.deepAnalysis}</span>
          </div>
        )}
        {item.impact && (
          <div className="flex gap-2.5">
            <span className="shrink-0 w-[4.5rem] text-[13px] leading-6 text-[var(--color-text-muted)]">行业影响</span>
            <span className="text-[15px] text-[var(--color-text-secondary)] leading-relaxed">{item.impact}</span>
          </div>
        )}
      </div>
    </article>
  );
}
