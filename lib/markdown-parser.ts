// Markdown 报告结构化解析器
// 基于六个固定章节标题解析，解析失败时保留原文，不丢弃数据

export interface CoreJudgment {
  text: string;
}

export interface HeadlineItem {
  index: number;
  title: string;
  source?: string;
  coreFact?: string;
  deepAnalysis?: string;
  impact?: string;
  link?: string;
  rawMarkdown: string;
}

export interface TrendItem {
  index: number;
  title: string;
  basis?: string;
  viewpoint?: string;
  rawMarkdown: string;
}

export interface OpportunityItem {
  index: number;
  title: string;
  source?: string;
  direction?: string;
  value?: string;
  rawMarkdown: string;
}

export interface ParsedReport {
  coreJudgments: CoreJudgment[];
  headlines: HeadlineItem[];
  trends: TrendItem[];
  opportunities: OpportunityItem[];
  sections: Array<{ level: number; title: string; raw: string }>;
}

/**
 * 按 ## 章节标题切分 Markdown
 * 报告固定结构：
 *   ## 一、今日核心判断
 *   ## 二、今日必读头条
 *   ## 三、重点领域动态
 *   ## 四、行业趋势观察
 *   ## 五、开发者与创业者机会
 *   ## 六、明日重点关注
 */
function splitSections(markdown: string): Array<{ title: string; raw: string }> {
  const sections: Array<{ title: string; raw: string }> = [];
  // 匹配 ## 开头的二级标题行
  const lines = markdown.split("\n");
  let currentTitle = "";
  let currentLines: string[] = [];
  let started = false;

  for (const line of lines) {
    const h2Match = line.match(/^##\s+(.+)$/);
    if (h2Match) {
      if (started) {
        sections.push({ title: currentTitle, raw: currentLines.join("\n") });
      }
      currentTitle = h2Match[1].trim();
      currentLines = [];
      started = true;
    } else if (started) {
      currentLines.push(line);
    }
  }
  if (started) {
    sections.push({ title: currentTitle, raw: currentLines.join("\n") });
  }
  return sections;
}

/**
 * 从有序列表中提取条目（1. 2. 3. 或 1.  2.  3.）
 * 返回每条项的文本和原始 Markdown
 */
function parseOrderedListItems(raw: string): Array<{ text: string; rawMarkdown: string }> {
  const items: Array<{ text: string; rawMarkdown: string }> = [];
  const lines = raw.split("\n");
  let currentItemLines: string[] = [];
  let inItem = false;

  for (const line of lines) {
    // 匹配有序列表项：数字. 或数字）
    const olMatch = line.match(/^\s*(\d+)[.)]\s+(.*)/);
    if (olMatch) {
      if (inItem) {
        items.push({
          text: currentItemLines.join(" ").trim(),
          rawMarkdown: currentItemLines.join("\n").trim(),
        });
      }
      currentItemLines = [olMatch[2]];
      inItem = true;
    } else if (inItem) {
      // 续行（缩进或空行后的内容）
      if (line.trim() === "" && currentItemLines.length > 0) {
        items.push({
          text: currentItemLines.join(" ").trim(),
          rawMarkdown: currentItemLines.join("\n").trim(),
        });
        currentItemLines = [];
        inItem = false;
      } else {
        currentItemLines.push(line.trim());
      }
    }
  }
  if (inItem && currentItemLines.length > 0) {
    items.push({
      text: currentItemLines.join(" ").trim(),
      rawMarkdown: currentItemLines.join("\n").trim(),
    });
  }
  return items;
}

/**
 * 从头条章节解析 ### N. 标题 + 列表字段
 */
function parseHeadlines(raw: string): HeadlineItem[] {
  const items: HeadlineItem[] = [];
  // 按 ### N. 切分
  const headlineBlocks = raw.split(/^###\s+/m).filter((s) => s.trim());

  for (const block of headlineBlocks) {
    const lines = block.split("\n");
    const titleLine = lines[0]?.trim() ?? "";
    // 提取序号
    const indexMatch = titleLine.match(/^(\d+)\./);
    const index = indexMatch ? parseInt(indexMatch[1], 10) : items.length + 1;
    const title = titleLine.replace(/^\d+\.\s*/, "").trim();

    const item: HeadlineItem = {
      index,
      title,
      rawMarkdown: block.trim(),
    };

    // 解析列表字段
    const remaining = lines.slice(1).join("\n");
    const fieldLines = remaining.split("\n");
    for (const fl of fieldLines) {
      // 原文格式：- **来源及发布时间**：OpenAI，2026-11-04 ...（冒号在加粗外）
      const fm = fl.match(/^\s*-\s*\*\*(.+?)\*\*[：:]\s*(.*)/);
      if (fm) {
        const key = fm[1].trim();
        const val = fm[2].trim();
        switch (key) {
          case "来源及发布时间":
            item.source = val;
            break;
          case "核心事实":
            item.coreFact = val;
            break;
          case "深度解读":
            item.deepAnalysis = val;
            break;
          case "对行业的影响":
            item.impact = val;
            break;
          case "原文链接":
            item.link = val;
            break;
        }
      }
    }

    items.push(item);
  }

  return items;
}

/**
 * 趋势和机会条目按有序列表解析，提取标题和子字段
 */
function parseTrends(raw: string): TrendItem[] {
  return parseOrderedListItems(raw).map((item, i) => {
    const titleMatch = item.rawMarkdown.match(/\*\*(.+?)\*\*/);
    const title = titleMatch ? titleMatch[1].trim() : item.text.split("：")[0]?.trim() || `趋势 ${i + 1}`;
    const result: TrendItem = { index: i + 1, title, rawMarkdown: item.rawMarkdown };
    const basis = item.rawMarkdown.match(/\*\*判断依据\*\*[：:]\s*(.+)/);
    const viewpoint = item.rawMarkdown.match(/\*\*观点\*\*[：:]\s*(.+)/);
    if (basis) result.basis = basis[1].trim();
    if (viewpoint) result.viewpoint = viewpoint[1].trim();
    return result;
  });
}

function parseOpportunities(raw: string): OpportunityItem[] {
  return parseOrderedListItems(raw).map((item, i) => {
    const titleMatch = item.rawMarkdown.match(/\*\*(.+?)\*\*/);
    const title = titleMatch ? titleMatch[1].trim() : item.text.split("：")[0]?.trim() || `机会 ${i + 1}`;
    const result: OpportunityItem = { index: i + 1, title, rawMarkdown: item.rawMarkdown };
    const source = item.rawMarkdown.match(/\*\*机会来源\*\*[：:]\s*(.+)/);
    const direction = item.rawMarkdown.match(/\*\*实现方向\*\*[：:]\s*(.+)/);
    const value = item.rawMarkdown.match(/\*\*潜在价值\*\*[：:]\s*(.+)/);
    if (source) result.source = source[1].trim();
    if (direction) result.direction = direction[1].trim();
    if (value) result.value = value[1].trim();
    return result;
  });
}

/** 去除纯展示文本里的行内 Markdown 标记（原文不修改，仅用于卡片展示） */
function stripInlineMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/\[(.+?)\]\((.+?)\)/g, "$1")
    .trim();
}

export function parseReport(markdown: string | null): ParsedReport | null {
  if (!markdown) return null;

  const sections = splitSections(markdown);
  const result: ParsedReport = {
    coreJudgments: [],
    headlines: [],
    trends: [],
    opportunities: [],
    sections: [],
  };

  for (const section of sections) {
    const title = section.title;
    const raw = section.raw;

    // 记录所有章节用于目录
    result.sections.push({ level: 2, title, raw });

    if (/核心判断/.test(title)) {
      const items = parseOrderedListItems(raw);
      result.coreJudgments = items.map((item) => ({ text: stripInlineMarkdown(item.text) }));
    } else if (/必读头条|今日头条/.test(title)) {
      result.headlines = parseHeadlines(raw);
    } else if (/趋势观察|行业趋势/.test(title)) {
      result.trends = parseTrends(raw);
    } else if (/创业者机会|商业机会|开发者与创业者机会/.test(title)) {
      result.opportunities = parseOpportunities(raw);
    }
  }

  return result;
}

/* ------------------------- 目录（TOC）构建 ------------------------- */

export interface TocItem {
  level: number;
  text: string;
  id: string;
  /** Markdown 源码中的行号（从 1 开始），用于把目录项与渲染出的标题精确对应 */
  line: number;
}

/** 生成稳定的锚点 id：保留中英文与数字，其余转连字符 */
export function slugify(text: string): string {
  const base = text
    .replace(/[*_`~]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\u4e00-\u9fff]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return base || "section";
}

/**
 * 按 Markdown 原文构建 1~3 级标题目录
 * 重复标题会追加序号（-2、-3），保证锚点唯一
 */
export function buildToc(markdown: string | null): TocItem[] {
  if (!markdown) return [];
  const lines = markdown.split("\n");
  const used = new Map<string, number>();
  const items: TocItem[] = [];

  lines.forEach((line, idx) => {
    const m = line.match(/^(#{1,3})\s+(.+?)\s*#*\s*$/);
    if (!m) return;
    const level = m[1].length;
    const text = stripInlineMarkdown(m[2].trim());
    if (!text) return;

    let id = slugify(text);
    const seen = used.get(id) ?? 0;
    used.set(id, seen + 1);
    if (seen > 0) id = `${id}-${seen + 1}`;

    items.push({ level, text, id, line: idx + 1 });
  });

  return items;
}
