import type { ReactNode } from "react";

interface SectionPanelProps {
  title: string;
  count: number | null;
  /** 板块专属色标（橙=头条 / 紫=趋势 / 绿=机会） */
  dotColor: string;
  icon: ReactNode;
  children: ReactNode;
}

/**
 * 首页三大板块容器：固定头部 + 可滚动内容区。
 * 桌面端与相邻板块等高、占满剩余屏高，内容超出时内部滚动。
 */
export function SectionPanel({ title, count, dotColor, icon, children }: SectionPanelProps) {
  return (
    <section className="glass-card flex flex-col min-h-0 overflow-hidden">
      <header className="shrink-0 flex items-center gap-2.5 px-5 py-4 border-b border-[var(--color-border-subtle)]">
        <span
          className="w-2.5 h-2.5 rounded-[3px] shrink-0"
          style={{ background: dotColor }}
          aria-hidden
        />
        <span className="shrink-0" style={{ color: dotColor }}>
          {icon}
        </span>
        <h2 className="text-[20px] lg:text-[22px] font-bold text-[var(--color-text-primary)]">
          {title}
        </h2>
        {count !== null && (
          <span className="ml-1 px-2.5 py-0.5 rounded-full text-xs tabular-nums bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)]">
            {count} 条
          </span>
        )}
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto p-4 lg:p-5 flex flex-col gap-3">
        {children}
      </div>
    </section>
  );
}
