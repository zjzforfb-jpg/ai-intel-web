// 趋势页统计概览卡（服务端组件）：重点数字放大显示
import { CalendarDays, FileText, Flame, Hash } from "lucide-react";

interface StatCardsProps {
  reports: number;
  articles: number;
  headlines: number;
  keywordCount: number;
}

const CARDS = [
  {
    key: "reports",
    label: "统计报告",
    unit: "篇",
    icon: CalendarDays,
    color: "var(--chart-1)",
  },
  {
    key: "articles",
    label: "累计收录文章",
    unit: "篇",
    icon: FileText,
    color: "var(--chart-5)",
  },
  {
    key: "headlines",
    label: "累计重点头条",
    unit: "条",
    icon: Flame,
    color: "var(--chart-2)",
  },
  {
    key: "keywords",
    label: "识别热词",
    unit: "个",
    icon: Hash,
    color: "var(--chart-4)",
  },
] as const;

export function StatCards({ reports, articles, headlines, keywordCount }: StatCardsProps) {
  const values: Record<string, number> = {
    reports,
    articles,
    headlines,
    keywords: keywordCount,
  };

  return (
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
      {CARDS.map((c) => {
        const Icon = c.icon;
        return (
          <div key={c.key} className="card-m flex items-center gap-3.5 min-w-0">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
              style={{
                background: `color-mix(in srgb, ${c.color} 12%, transparent)`,
                color: c.color,
              }}
              aria-hidden
            >
              <Icon size={19} />
            </div>
            <div className="min-w-0">
              <div className="text-[11px] text-[var(--color-text-muted)] mb-1">
                {c.label}
              </div>
              <div className="text-[22px] font-bold text-[var(--color-text-primary)] tnum leading-none">
                {values[c.key]}
                <span className="text-[11px] font-normal text-[var(--color-text-muted)] ml-1">
                  {c.unit}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
