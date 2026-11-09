import { Sparkles } from "lucide-react";

interface StatChip {
  label: string;
  value: number | string | null;
}

interface CoreJudgmentCardProps {
  items: Array<{ text: string }>;
  /** 横幅右上角的统计徽章 */
  stats?: StatChip[];
  /** 报告元信息小字行，如「报告日期 2026-11-05 · 生成时间 20:53」 */
  meta?: string;
}

/**
 * 首页焦点区：今日核心判断。
 *
 * 全页唯一视觉强调，用 .focus-zone（accent 2px 描边）。
 * 旧版是「顶部渐变描边 + 硬编码 indigo 徽章」——渐变在两套主题下都不成立，
 * 且与设计规范「禁止过多渐变发光」冲突，已统一为令牌色。
 */
export function CoreJudgmentCard({ items, stats = [], meta }: CoreJudgmentCardProps) {
  return (
    <section className="focus-zone">
      {/* 标题行：标题 + 元信息 + 统计徽章 */}
      <div className="flex items-center gap-3 flex-wrap mb-4">
        <span
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{
            color: "var(--color-accent-light)",
            background: "var(--color-accent-glow)",
          }}
          aria-hidden
        >
          <Sparkles size={17} />
        </span>
        <h2 className="text-[18px] font-bold text-[var(--color-text-primary)]">
          今日核心判断
        </h2>
        {meta && <span className="text-[11px] text-[var(--color-text-muted)]">{meta}</span>}

        {stats.length > 0 && (
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            {stats.map((s) => (
              <span key={s.label} className="badge">
                {s.label}
                <span className="text-[13px] font-bold text-[var(--color-text-primary)] tnum">
                  {s.value ?? "待统计"}
                </span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 判断条目：桌面 2×2，窄屏单列 */}
      {items.length === 0 ? (
        <p className="text-[13px] text-[var(--color-text-muted)]">
          暂不可解析，请通过完整报告查看。
        </p>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-x-8 gap-y-3.5">
          {items.map((item, idx) => (
            <div key={idx} className="flex gap-3 min-w-0">
              <span
                className="shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-[12px] font-bold tnum mt-0.5"
                style={{
                  color: "var(--color-accent-light)",
                  background: "var(--color-accent-glow)",
                }}
              >
                {idx + 1}
              </span>
              <p className="text-[14px] text-[var(--color-text-secondary)] leading-relaxed min-w-0 [overflow-wrap:anywhere]">
                {item.text}
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
