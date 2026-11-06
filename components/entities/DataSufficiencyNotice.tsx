import { Info } from "lucide-react";

interface DataSufficiencyNoticeProps {
  mentionCount: number;
  distinctMentionDays: number;
}

/**
 * 数据不足提示（契约 §4 硬性规则）：
 * 提及 < 3 次或覆盖 < 2 天时，页面必须显示「数据不足，暂不构成趋势」，
 * 且不得输出任何趋势结论。这里只陈述事实计数，不做推断。
 */
export function DataSufficiencyNotice({
  mentionCount,
  distinctMentionDays,
}: DataSufficiencyNoticeProps) {
  return (
    <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.07] p-4 flex items-start gap-3">
      <Info size={16} className="text-[var(--color-warning)] mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p className="text-[14px] font-medium text-[var(--color-text-primary)]">
          数据不足，暂不构成趋势
        </p>
        <p className="text-[13px] text-[var(--color-text-secondary)] mt-1 leading-relaxed">
          当前累计 {mentionCount} 次提及、覆盖 {distinctMentionDays} 个日报日期；
          判定门槛为「≥3 次提及且 ≥2 个日期」。以下内容仅供逐条查阅，不构成趋势判断。
        </p>
      </div>
    </div>
  );
}
