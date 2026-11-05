// 热词榜（服务端组件）：排名 + 词 + 热度条 + 逐日缩略图 + 统计数字
import Link from "next/link";
import { Search } from "lucide-react";
import type { KeywordStat } from "@/lib/trends";
import { Sparkline } from "./Sparkline";

interface KeywordListProps {
  keywords: KeywordStat[];
  /** 每个热词缩略图配色（与折线图系列一致） */
  colors: string[];
}

export function KeywordList({ keywords, colors }: KeywordListProps) {
  const maxScore = Math.max(...keywords.map((k) => k.score), 1);

  return (
    <ol className="flex flex-col gap-2">
      {keywords.map((k, i) => (
        <li
          key={k.term}
          className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-card)]/60 px-3.5 py-3 hover:border-[var(--color-border-glow)] transition-colors"
        >
          <div className="flex items-center gap-3 flex-wrap sm:flex-nowrap">
            <span className="shrink-0 w-8 text-[13px] font-bold tabular-nums text-[var(--color-text-muted)]">
              {String(i + 1).padStart(2, "0")}
            </span>

            <Link
              href={`/history?q=${encodeURIComponent(k.term)}`}
              className="shrink-0 inline-flex items-center gap-1.5 text-[16px] font-semibold text-[var(--color-text-primary)] hover:text-[var(--color-accent-light)] transition-colors"
              title={`在历史档案馆中搜索「${k.term}」`}
            >
              {k.term}
              <Search size={13} className="text-[var(--color-text-muted)]" />
            </Link>

            {/* 热度条 */}
            <div className="order-last sm:order-none w-full sm:flex-1 min-w-0 h-2 rounded-full bg-[var(--color-bg-base)] overflow-hidden">
              <div
                className="h-2 rounded-full"
                style={{
                  width: `${Math.max(4, (k.score / maxScore) * 100)}%`,
                  background: `linear-gradient(90deg, ${colors[i % colors.length]}, ${colors[i % colors.length]}88)`,
                }}
              />
            </div>

            <div className="ml-auto flex items-center gap-3 flex-wrap justify-end min-w-0">
              <Sparkline points={k.series} color={colors[i % colors.length]} />
              <div className="text-[13px] text-[var(--color-text-muted)] tabular-nums whitespace-nowrap">
                热度 <span className="text-[var(--color-text-secondary)] font-semibold">{k.score}</span>
                <span className="mx-1.5 text-[var(--color-border-glow)]">·</span>
                出现 <span className="text-[var(--color-text-secondary)] font-semibold">{k.count}</span> 次
                <span className="mx-1.5 text-[var(--color-border-glow)]">·</span>
                <span className="text-[var(--color-text-secondary)] font-semibold">{k.days}</span> 天
              </div>
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
