import Link from "next/link";
import { CalendarDays, ExternalLink, Gauge } from "lucide-react";
import type { EntityMentionRow } from "@/lib/entities";

interface MentionTimelineProps {
  mentions: EntityMentionRow[];
}

/** 重要度配色：>=8 高 / 5-7 中 / <=4 低 */
function scoreClass(score: number): string {
  if (score >= 8) return "bg-red-500/15 text-red-400 border-red-500/30";
  if (score >= 5) return "bg-amber-500/15 text-amber-400 border-amber-500/30";
  return "bg-gray-500/15 text-gray-400 border-gray-500/30";
}

/** 提及时间线：按日报日期分组，逐条给出头条标题、原文链接与上下文 */
export function MentionTimeline({ mentions }: MentionTimelineProps) {
  if (mentions.length === 0) {
    return (
      <p className="text-[13px] text-[var(--color-text-muted)]">
        暂无提及记录。实体提及由 n8n 在日报入库后自动抽取写入。
      </p>
    );
  }

  const groups: Array<{ date: string; items: EntityMentionRow[] }> = [];
  for (const m of mentions) {
    const last = groups[groups.length - 1];
    if (last && last.date === m.mentionDate) last.items.push(m);
    else groups.push({ date: m.mentionDate, items: [m] });
  }

  return (
    <div className="flex flex-col gap-5">
      {groups.map((group) => (
        <section key={group.date} className="flex flex-col gap-2">
          <h3 className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--color-text-secondary)] tabular-nums">
            <CalendarDays size={13} />
            {group.date}
            <span className="text-[var(--color-text-muted)] font-normal">
              （{group.items.length} 条）
            </span>
            <Link
              href={`/report/${group.date}`}
              className="text-[12px] text-[var(--color-link)] hover:underline font-normal"
            >
              查看日报
            </Link>
          </h3>

          <ul className="flex flex-col gap-2">
            {group.items.map((m) => (
              <li key={m.id} className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-card)]/50 p-3.5">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    {m.sourceUrl ? (
                      <a
                        href={m.sourceUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-start gap-1.5 text-[14px] font-medium text-[var(--color-text-primary)] hover:text-[var(--color-link)] transition-colors [overflow-wrap:anywhere]"
                      >
                        {m.sourceTitle ?? "未命名头条"}
                        <ExternalLink size={12} className="mt-1 shrink-0" />
                      </a>
                    ) : (
                      <span className="text-[14px] font-medium text-[var(--color-text-primary)] [overflow-wrap:anywhere]">
                        {m.sourceTitle ?? "未命名头条"}
                      </span>
                    )}
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[12px] font-medium tabular-nums shrink-0 ${scoreClass(m.importanceScore)}`}
                  >
                    <Gauge size={11} />
                    {m.importanceScore}
                  </span>
                </div>

                {m.context && (
                  <p className="mt-2 text-[13px] leading-relaxed text-[var(--color-text-secondary)] [overflow-wrap:anywhere]">
                    {m.context}
                  </p>
                )}

                <p className="mt-2 text-[12px] text-[var(--color-text-muted)]">
                  {m.sourceUrl ? (
                    <a
                      href={m.sourceUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="hover:text-[var(--color-link)] [overflow-wrap:anywhere]"
                    >
                      {m.sourceUrl}
                    </a>
                  ) : (
                    "无来源链接"
                  )}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
