import type { SnippetSegment } from "@/lib/search";

/** 去除摘要里的 Markdown 标记（**加粗**、# 标题、行首列表符），只影响展示 */
function cleanMd(text: string): string {
  return text
    .replace(/\*\*/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "");
}

/**
 * 搜索结果的上下文摘要：命中关键词以 <mark> 高亮。
 * 纯文本切片渲染（React 自动转义），不注入任何 HTML。
 */
export function SearchSnippet({ segments }: { segments: SnippetSegment[] }) {
  return (
    <p className="mt-2 text-[13px] leading-relaxed text-[var(--color-text-muted)]">
      {segments.map((s, i) =>
        s.hit ? (
          <mark
            key={i}
            className="bg-indigo-500/25 text-indigo-200 rounded px-0.5 py-px"
          >
            {cleanMd(s.text)}
          </mark>
        ) : (
          <span key={i}>{cleanMd(s.text)}</span>
        )
      )}
    </p>
  );
}
