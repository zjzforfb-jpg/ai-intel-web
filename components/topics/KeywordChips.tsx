/**
 * 关键词 chips。
 * 传入 titleHits 时，命中标题的关键词以高亮样式显示（与仅正文命中的词区分）。
 */
export function KeywordChips({
  keywords,
  titleHits,
  emptyText = "暂无关键词",
}: {
  keywords: string[];
  titleHits?: string[];
  emptyText?: string;
}) {
  if (keywords.length === 0) {
    return <p className="text-[13px] text-[var(--color-text-muted)]">{emptyText}</p>;
  }
  const titleSet = new Set(titleHits ?? []);
  return (
    <div className="flex flex-wrap gap-1.5">
      {keywords.map((k) => {
        const isTitleHit = titleHits !== undefined && titleSet.has(k);
        return (
          <span
            key={k}
            className={`inline-flex max-w-full items-center rounded-md border px-2 py-0.5 text-[13px] break-all ${
              isTitleHit
                ? "border-[var(--color-accent)] bg-[var(--color-accent-glow)] text-[var(--color-accent-light)]"
                : "border-[var(--color-border-subtle)] bg-[var(--color-bg-card)] text-[var(--color-text-secondary)]"
            }`}
          >
            {k}
          </span>
        );
      })}
    </div>
  );
}
