import { Sparkles } from "lucide-react";

interface StatChip {
  label: string;
  value: number | string | null;
}

interface CoreJudgmentCardProps {
  items: Array<{ text: string }>;
  /** 横幅右上角的统计徽章（原独立统计卡收进这里） */
  stats?: StatChip[];
  /** 报告元信息小字行，如「报告日期 2026-11-05 · 生成时间 20:53」 */
  meta?: string;
}

/**
 * 首页第一行通栏横幅：今日核心判断。
 * 全页唯一视觉焦点——顶部渐变描边 + 大标题 + 判断条目并排一行。
 */
export function CoreJudgmentCard({ items, stats = [], meta }: CoreJudgmentCardProps) {
  return (
    <section className="glass-card relative shrink-0 overflow-hidden">
      {/* 顶部渐变描边：制造全页唯一焦点 */}
      <div
        className="absolute top-0 inset-x-0 h-[3px]"
        style={{
          background:
            "linear-gradient(90deg, #6366f1 0%, #818cf8 35%, rgba(129,140,248,0.25) 70%, transparent 100%)",
        }}
        aria-hidden
      />

      <div className="p-4 lg:p-5">
        {/* 标题行：标题 + 元信息 + 统计徽章 */}
        <div className="flex items-center gap-3 flex-wrap mb-3.5">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500/25 to-blue-500/25 border border-indigo-500/25 flex items-center justify-center shrink-0">
            <Sparkles size={19} className="text-indigo-300" />
          </div>
          <h2 className="text-[22px] lg:text-[24px] font-bold text-[var(--color-text-primary)]">
            今日核心判断
          </h2>
          {meta && (
            <span className="text-xs text-[var(--color-text-muted)]">{meta}</span>
          )}

          {stats.length > 0 && (
            <div className="ml-auto flex items-center gap-2 flex-wrap">
              {stats.map((s) => (
                <span
                  key={s.label}
                  className="inline-flex items-baseline gap-1.5 px-3 py-1 rounded-full text-xs bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] text-[var(--color-text-muted)]"
                >
                  {s.label}
                  <span className="text-[15px] font-bold text-[var(--color-text-primary)] tabular-nums">
                    {s.value ?? "待统计"}
                  </span>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* 判断条目：桌面一行四列，窄屏自动换行 */}
        {items.length === 0 ? (
          <p className="text-base text-[var(--color-text-muted)]">暂不可解析，请通过完整报告查看。</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-x-6 gap-y-4">
            {items.map((item, idx) => (
              <div key={idx} className="flex gap-3">
                <span className="shrink-0 w-7 h-7 rounded-md bg-indigo-500/15 text-indigo-300 border border-indigo-500/25 flex items-center justify-center text-sm font-bold">
                  {idx + 1}
                </span>
                <p className="text-[15px] lg:text-base text-[var(--color-text-secondary)] leading-relaxed">
                  {item.text}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
