import { FileText, Flame, TrendingUp, Target } from "lucide-react";

interface StatCardProps {
  label: string;
  value: number | string | null;
  icon: "articles" | "headlines" | "trends" | "opportunities";
  accent?: "indigo" | "blue" | "purple" | "emerald";
}

const iconMap = {
  articles: FileText,
  headlines: Flame,
  trends: TrendingUp,
  opportunities: Target,
};

const accentMap = {
  indigo: { color: "#818cf8", bg: "rgba(129, 140, 248, 0.1)" },
  blue: { color: "#60a5fa", bg: "rgba(96, 165, 250, 0.1)" },
  purple: { color: "#c084fc", bg: "rgba(192, 132, 252, 0.1)" },
  emerald: { color: "#34d399", bg: "rgba(52, 211, 153, 0.1)" },
};

export function StatCard({ label, value, icon, accent = "indigo" }: StatCardProps) {
  const Icon = iconMap[icon];
  const ac = accentMap[accent];

  return (
    <div className="glass-card p-5 flex items-center gap-4">
      <div
        className="w-11 h-11 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: ac.bg, color: ac.color }}
      >
        <Icon size={22} />
      </div>
      <div className="min-w-0">
        <div className="text-xs text-[var(--color-text-muted)] mb-0.5">{label}</div>
        {value === null ? (
          <div className="text-lg font-semibold text-[var(--color-text-muted)]">待统计</div>
        ) : (
          <div className="text-2xl font-bold text-[var(--color-text-primary)] tabular-nums">
            {value}
          </div>
        )}
      </div>
    </div>
  );
}
