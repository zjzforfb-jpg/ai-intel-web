/**
 * 搜索辅助：关键词解析 + 匹配摘要切片
 * 纯字符串处理，不接触数据库，可在服务端组件直接使用。
 */

/** 摘要片段：hit=true 的段落渲染为高亮 */
export interface SnippetSegment {
  text: string;
  hit: boolean;
}

/**
 * 拆分搜索关键词：按空白（半角/全角）切分、去重、限 8 个、每个限 40 字符。
 * 防止超长输入拖慢 ILIKE 扫描。
 */
export function parseKeywords(q: string | string[] | undefined | null): string[] {
  const raw = Array.isArray(q) ? q[0] : q;
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[\s　]+/)) {
    const k = part.trim().slice(0, 40);
    if (!k) continue;
    const key = k.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(k);
    if (out.length >= 8) break;
  }
  return out;
}

/**
 * 从正文中截取包含关键词的上下文摘要（大小写不敏感）。
 * 无任何关键词命中时返回 null（调用方回退到正文开头摘要或不显示）。
 */
export function buildSnippet(
  text: string | null | undefined,
  keywords: string[],
  radius = 80
): SnippetSegment[] | null {
  if (!text || keywords.length === 0) return null;
  const lower = text.toLowerCase();

  // 以最早出现的关键词为中心开窗
  let firstIdx = -1;
  for (const k of keywords) {
    const i = lower.indexOf(k.toLowerCase());
    if (i !== -1 && (firstIdx === -1 || i < firstIdx)) firstIdx = i;
  }
  if (firstIdx === -1) return null;

  const start = Math.max(0, firstIdx - radius);
  const end = Math.min(text.length, firstIdx + radius + 20);
  const slice = text.slice(start, end);
  const sliceLower = slice.toLowerCase();

  // 收集窗口内所有命中区间并合并重叠
  const ranges: Array<[number, number]> = [];
  for (const k of keywords) {
    const kl = k.toLowerCase();
    if (!kl) continue;
    let pos = 0;
    for (;;) {
      const i = sliceLower.indexOf(kl, pos);
      if (i === -1) break;
      ranges.push([i, i + k.length]);
      pos = i + k.length;
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }

  const segments: SnippetSegment[] = [];
  if (start > 0) segments.push({ text: "…", hit: false });
  let cursor = 0;
  for (const [s, e] of merged) {
    if (s > cursor) segments.push({ text: slice.slice(cursor, s), hit: false });
    segments.push({ text: slice.slice(s, e), hit: true });
    cursor = e;
  }
  if (cursor < slice.length) segments.push({ text: slice.slice(cursor), hit: false });
  if (end < text.length) segments.push({ text: "…", hit: false });
  return segments;
}
