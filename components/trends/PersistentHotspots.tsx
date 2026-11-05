// 持续热点区块（服务端组件）：≥2 个不同报告日反复出现的关键词
import Link from "next/link";
import { Repeat, CalendarCheck, Flame, Search } from "lucide-react";
import type { PersistentHotspot } from "@/lib/trends";

interface PersistentHotspotsProps {
  items: PersistentHotspot[];
  /** 当前范围内报告日数（空态提示用） */
  reportDays: number;
}

export function PersistentHotspots({ items, reportDays }: PersistentHotspotsProps) {
  if (items.length === 0) {
    return (
      <div className="glass-card p-8 text-center">
        <Repeat size={26} className="text-[var(--color-text-muted)] mx-auto mb-3" />
        <p className="text-[15px] text-[var(--color-text-secondary)] mb-1">
          暂无持续热点
        </p>
        <p className="text-[13px] text-[var(--color-text-muted)] max-w-md mx-auto leading-relaxed">
          持续热点需要关键词在 ≥2 个不同日期的日报中反复出现。
          {reportDays <= 1
            ? `当前范围内只有 ${reportDays} 个报告日，待日报积累后自动识别。`
            : `当前范围内有 ${reportDays} 个报告日，但尚无跨日重复出现的关键词。`}
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      {items.map((k) => (
        <div
          key={k.term}
          className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-card)]/60 p-4 hover:border-[var(--color-border-glow)] transition-colors min-w-0"
        >
          <div className="flex items-center gap-2.5 flex-wrap mb-2">
            <Link
              href={`/history?q=${encodeURIComponent(k.term)}`}
              className="inline-flex items-center gap-1.5 text-[17px] font-semibold text-[var(--color-text-primary)] hover:text-[var(--color-accent-light)] transition-colors"
              title={`在历史档案馆中搜索「${k.term}」`}
            >
              {k.term}
              <Search size={13} className="text-[var(--color-text-muted)]" />
            </Link>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[13px] bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
              <CalendarCheck size={12} />
              {k.days} 天
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[13px] bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
              <Repeat size={12} />
              最长连续 {k.maxStreak} 天
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[13px] bg-amber-500/10 text-amber-300 border border-amber-500/20">
              <Flame size={12} />
              热度 {k.score}
            </span>
          </div>

          {/* 逐日出现明细 */}
          <div className="flex items-center gap-x-3 gap-y-1.5 flex-wrap">
            {k.series.map((p) => (
              <span
                key={p.date}
                className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[13px] tabular-nums border ${
                  p.count > 0
                    ? "border-[var(--color-border-glow)] text-[var(--color-text-secondary)] bg-[var(--color-bg-base)]"
                    : "border-[var(--color-border-subtle)] text-[var(--color-text-muted)]"
                }`}
              >
                {p.date.slice(5)}
                <span
                  className={
                    p.count > 0
                      ? "font-semibold text-[var(--color-text-primary)]"
                      : ""
                  }
                >
                  {p.count > 0 ? `${p.count} 次` : "—"}
                </span>
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
