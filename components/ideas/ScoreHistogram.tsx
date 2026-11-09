import type { IdeaScoreHistogram } from "@/lib/ideas";

/**
 * 价值分分布（1-10 直方图）。
 *
 * 纯 div 柱，不用 SVG —— 柱子数量固定 10 根，用 flex + 百分比高度更省事，
 * 也更容易在暗/暖两套主题下自适应（颜色全部走 CSS 变量）。
 * 高分区间（≥ 阈值）用 accent 色，低分区间用 muted 色，形成视觉梯度。
 */
export function ScoreHistogram({
  histogram,
  threshold,
  total,
}: {
  histogram: IdeaScoreHistogram;
  /** 高分阈值，≥ 该值的柱子高亮 */
  threshold: number;
  /** 已评分数（分母） */
  total: number;
}) {
  const scores = Object.keys(histogram)
    .map(Number)
    .sort((a, b) => a - b);
  const max = Math.max(1, ...scores.map((s) => histogram[s] ?? 0));
  const peak = scores.reduce(
    (best, s) => ((histogram[s] ?? 0) > (histogram[best] ?? 0) ? s : best),
    scores[0] ?? 1
  );

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-end gap-1.5 h-[104px]">
        {scores.map((s) => {
          const count = histogram[s] ?? 0;
          const ratio = count / max;
          const isHigh = s >= threshold;
          return (
            <div key={s} className="flex-1 flex flex-col items-center gap-1 min-w-0">
              <div className="w-full flex items-center justify-center h-[16px]">
                {count > 0 && (
                  <span className="text-[10px] tnum text-[var(--color-text-muted)] leading-none">
                    {count}
                  </span>
                )}
              </div>
              <div
                className="w-full rounded-t-[3px] transition-[height,background-color] duration-300"
                style={{
                  height: `${Math.max(count > 0 ? 6 : 2, ratio * 62)}px`,
                  background: isHigh
                    ? "var(--color-accent)"
                    : "color-mix(in srgb, var(--color-text-muted) 45%, transparent)",
                }}
                title={`${s} 分：${count} 条`}
              />
              <span
                className={`text-[10px] tnum leading-none ${
                  s === peak ? "text-[var(--color-text-primary)] font-medium" : "text-[var(--color-text-muted)]"
                }`}
              >
                {s}
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-[var(--color-text-muted)]">
        共 {total} 条已评分 · 高分 ≥ {threshold} 分
      </p>
    </div>
  );
}
