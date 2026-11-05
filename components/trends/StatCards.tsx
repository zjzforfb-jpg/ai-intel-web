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
    color: "#818cf8",
    bg: "rgba(129, 140, 248, 0.1)",
  },
  {
    key: "articles",
    label: "累计收录文章",
    unit: "篇",
    icon: FileText,
    color: "#60a5fa",
    bg: "rgba(96, 165, 250, 0.1)",
  },
  {
    key: "headlines",
    label: "累计重点头条",
    unit: "条",
    icon: Flame,
    color: "#34d399",
    bg: "rgba(52, 211, 153, 0.1)",
  },
  {
    key: "keywords",
    label: "识别热词",
    unit: "个",
    icon: Hash,
    color: "#c084fc",
    bg: "rgba(192, 132, 252, 0.1)",
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
          <div key={c.key} className="glass-card p-4 lg:p-5 flex items-center gap-3.5 min-w-0">
            <div
              className="w-11 h-11 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: c.bg, color: c.color }}
            >
              <Icon size={22} />
            </div>
            <div className="min-w-0">
              <div className="text-[13px] text-[var(--color-text-muted)] mb-0.5">
                {c.label}
              </div>
              <div className="text-2xl lg:text-[28px] font-bold text-[var(--color-text-primary)] tabular-nums leading-none">
                {values[c.key]}
                <span className="text-[13px] font-normal text-[var(--color-text-muted)] ml-1">
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
