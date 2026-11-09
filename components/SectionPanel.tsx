import type { ReactNode } from "react";

export type SectionZone = "headline" | "trend" | "opportunity";

interface SectionPanelProps {
  title: string;
  count: number | null;
  /** 板块语义色（走主题令牌 --color-zone-*） */
  zone: SectionZone;
  icon: ReactNode;
  children: ReactNode;
}

/** 板块 → CSS 变量名 */
const ZONE_VAR: Record<SectionZone, string> = {
  headline: "--color-zone-headline",
  trend: "--color-zone-trend",
  opportunity: "--color-zone-opportunity",
};

/**
 * 首页三大板块容器。
 *
 * 与旧版的差别：旧版在桌面端把每个面板钉成「占满屏高 + 内部滚动」，
 * 结果是三层嵌套滚动（页面 / 面板 / 面板内列表），滚轮体验割裂，
 * 且窗口一矮内容就被裁。这里改回自然高度、整页滚动，
 * 由栅格在同一行内自行对齐。
 */
export function SectionPanel({ title, count, zone, icon, children }: SectionPanelProps) {
  const colorVar = `var(${ZONE_VAR[zone]})`;

  return (
    <section
      className="card-l flex flex-col min-w-0"
      style={{
        borderTopColor: colorVar,
        borderTopWidth: 3,
        borderTopLeftRadius: 12,
        borderTopRightRadius: 12,
      }}
    >
      <header className="flex items-center gap-2 mb-4">
        <span
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{
            color: colorVar,
            background: `color-mix(in srgb, ${colorVar} 12%, transparent)`,
          }}
          aria-hidden
        >
          {icon}
        </span>
        <h2 className="text-[16px] font-semibold text-[var(--color-text-primary)] min-w-0">
          {title}
        </h2>
        {count !== null && (
          <span className="ml-auto shrink-0 badge tnum">{count} 条</span>
        )}
      </header>
      <div className="flex flex-col gap-3 min-w-0">{children}</div>
    </section>
  );
}
