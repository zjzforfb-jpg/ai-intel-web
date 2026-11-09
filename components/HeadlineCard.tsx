import { ExternalLink } from "lucide-react";
import type { HeadlineItem } from "@/lib/markdown-parser";

interface HeadlineCardProps {
  item: HeadlineItem;
}

/** 字段行：宽屏标签左置定宽；小屏标签在上，避免标签列挤占正文宽度 */
function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col sm:flex-row sm:gap-2.5 gap-0.5">
      <span className="shrink-0 sm:w-[4.5rem] text-[12px] leading-6 text-[var(--color-text-muted)]">
        {label}
      </span>
      <span className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed [overflow-wrap:anywhere] min-w-0">
        {value}
      </span>
    </div>
  );
}

/**
 * 头条条目：大标题 + 结构化字段。
 * 从「独立卡片」改为「条目 + 分隔线」——外层已由 SectionPanel 承载卡片，
 * 条目再套一层边框会形成俄罗斯套娃。
 */
export function HeadlineCard({ item }: HeadlineCardProps) {
  return (
    <article className="border-b border-[var(--color-border-subtle)] last:border-b-0 pb-3 last:pb-0">
      <div className="flex items-start gap-2.5 mb-2">
        <span
          className="shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-[12px] font-bold tnum mt-0.5"
          style={{
            color: "var(--color-zone-headline)",
            background: "color-mix(in srgb, var(--color-zone-headline) 12%, transparent)",
          }}
        >
          {item.index}
        </span>
        {item.link ? (
          <a
            href={item.link}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[14px] font-semibold text-[var(--color-text-primary)] hover:text-[var(--color-link)] transition-colors flex-1 leading-snug min-w-0 [overflow-wrap:anywhere]"
          >
            {item.title}
            <ExternalLink size={12} className="inline-block ml-1 align-baseline text-[var(--color-text-muted)]" />
          </a>
        ) : (
          <h4 className="text-[14px] font-semibold text-[var(--color-text-primary)] flex-1 leading-snug min-w-0 [overflow-wrap:anywhere]">
            {item.title}
          </h4>
        )}
      </div>

      <div className="flex flex-col gap-1.5 pl-[34px]">
        {item.source && <Field label="来源" value={item.source} />}
        {item.coreFact && <Field label="核心事实" value={item.coreFact} />}
        {item.deepAnalysis && <Field label="深度解读" value={item.deepAnalysis} />}
        {item.impact && <Field label="行业影响" value={item.impact} />}
      </div>
    </article>
  );
}
