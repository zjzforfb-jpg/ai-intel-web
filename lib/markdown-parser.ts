// Markdown 报告结构化解析器
// 基于六个固定章节标题解析，解析失败时保留原文，不丢弃数据
//
// 兼容两种 LLM 输出格式：
//   格式 A（DeepSeek 旧格式）：字段行 `- **字段名**：值`（冒号在加粗外）
//   格式 B（MiniMax 新格式）：字段行 `- **字段名：** 值`（冒号在加粗内）
// 两者在核心判断、趋势、机会上还存在「编号列表 / ### 标题 / 散文段落」的形态差异，
// 本文件统一用「条目抽取 + 字段别名表 + 诊断信息」三件套处理。

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
  /** 未识别但有值的字段（保留原文，不丢弃） */
  extra?: Record<string, string>;
}

export interface TrendItem {
  index: number;
  title: string;
  basis?: string;
  viewpoint?: string;
  rawMarkdown: string;
  /** 未识别但有值的字段（保留原文，不丢弃） */
  extra?: Record<string, string>;
}

export interface OpportunityItem {
  index: number;
  title: string;
  source?: string;
  direction?: string;
  value?: string;
  rawMarkdown: string;
  /** 未识别但有值的字段（保留原文，不丢弃） */
  extra?: Record<string, string>;
}

/** 解析诊断信息：记录「识别到章节但没解析出条目」与「有原文却无法结构化」的片段 */
export interface ParseDiagnostic {
  /** 该章节内未能解析成条目的原始片段 */
  unparsed: Array<{ section: string; fragment: string; reason: string }>;
  /** 哪些章节被识别到但 0 条目 */
  emptySections: string[];
}

export interface ParsedReport {
  coreJudgments: CoreJudgment[];
  headlines: HeadlineItem[];
  trends: TrendItem[];
  opportunities: OpportunityItem[];
  sections: Array<{ level: number; title: string; raw: string }>;
  /** 解析诊断信息（可选） */
  diagnostics?: ParseDiagnostic;
}

/* ------------------------- 字段别名表（契约 2.2） ------------------------- */

/** 头条章节：别名 → 规范字段 */
const HEADLINE_FIELD_ALIASES: Record<string, string> = {
  来源及发布时间: "source",
  来源和时间: "source",
  来源及时间: "source",
  来源: "source",
  核心事实: "coreFact",
  事实: "coreFact",
  深度解读: "deepAnalysis",
  深度分析: "deepAnalysis",
  解读: "deepAnalysis",
  对行业的影响: "impact",
  行业影响: "impact",
  影响: "impact",
  原文链接: "link",
  原文链接地址: "link",
  原始链接: "link",
  链接: "link",
  网址: "link",
};

/** 趋势章节：别名 → 规范字段 */
const TREND_FIELD_ALIASES: Record<string, string> = {
  判断依据: "basis",
  依据: "basis",
  观点: "viewpoint",
  观点解读: "viewpoint",
};

/** 机会章节：别名 → 规范字段 */
const OPPORTUNITY_FIELD_ALIASES: Record<string, string> = {
  机会来源: "source",
  来源: "source",
  实现方向: "direction",
  方向: "direction",
  潜在价值: "value",
  价值: "value",
};

/* ------------------------- 通用小工具 ------------------------- */

/** 去除纯展示文本里的行内 Markdown 标记（原文不修改，仅用于卡片展示） */
function stripInlineMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/\[(.+?)\]\((.+?)\)/g, "$1")
    .trim();
}

/**
 * 归一化字段键名：
 * - 去掉结尾冒号
 * - 剥掉括号后缀（`深度解读（观点）` → `深度解读`，括号内是副标题）
 * - 去掉空白
 */
function normalizeKey(raw: string): string {
  return raw
    .replace(/[：:]\s*$/, "")
    .replace(/[（(][^）)]*[）)]\s*$/g, "")
    .replace(/\s+/g, "")
    .trim();
}

/** 清洗字段值两端的分隔符（Markdown 列表符号、破折号等） */
function cleanValue(raw: string): string {
  return raw.replace(/^[\s\-–—•*·]+/, "").replace(/[\s\-–—•*·]+$/, "").trim();
}

/**
 * 从任意文本中提取裸 URL：
 * - 支持 `[文字](url)` Markdown 链接语法
 * - 支持 `<url>`、前后带标点、多个 URL 取第一个
 * - 结尾多余的右括号只在括号不配对时去掉（避免误删 Wikipedia 风格的 URL）
 */
export function extractBareUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const text = value.trim();

  // Markdown 链接语法：[文字](url)
  const md = text.match(/\[[^\]]*\]\(\s*([^)\s]+)\s*\)/);
  let candidate = md ? md[1] : undefined;

  if (!candidate) {
    const raw = text.match(/(?:https?:\/\/|www\.)[^\s<>"'`）]+/i);
    candidate = raw ? raw[0] : undefined;
  }
  if (!candidate) return undefined;

  // 去掉尾部标点；右括号仅在不配对时去掉
  let end = candidate.length;
  while (end > 0) {
    const ch = candidate[end - 1];
    if (".,;:!?、。，；：）]】」』\"'>".includes(ch)) {
      if (ch === ")" || ch === "）") {
        const open = candidate.slice(0, end - 1).split("(").length - 1;
        const close = candidate.slice(0, end).split(")").length - 1;
        if (open >= close) break;
      }
      end -= 1;
      continue;
    }
    break;
  }
  candidate = candidate.slice(0, end);
  if (!candidate) return undefined;
  if (/^www\./i.test(candidate)) candidate = `https://${candidate}`;
  return candidate;
}

/* ------------------------- 字段行解析 ------------------------- */

interface ParsedFieldLine {
  /** 归一化后的键名 */
  key: string;
  /** 原始键名（含括号后缀），用于 extra 归档 */
  rawKey: string;
  value: string;
  /** 是否带加粗标记（无加粗的裸键名只在命中别名表时才当字段） */
  bold: boolean;
}

/**
 * 解析一行字段，兼容冒号在加粗内 / 加粗外 / 无加粗三种写法：
 *   - **核心事实**：内容
 *   - **核心事实：** 内容
 *   - 核心事实: 内容
 */
function parseFieldLine(line: string): ParsedFieldLine | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const body = trimmed.replace(/^[-*+]\s+/, "").replace(/^>\s*/, "").trim();
  if (!body) return null;

  const build = (keyRaw: string, value: string, bold: boolean): ParsedFieldLine => ({
    key: normalizeKey(keyRaw),
    rawKey: keyRaw.trim(),
    value: value.trim(),
    bold,
  });

  // **键名**：值（冒号在加粗外）
  let m = body.match(/^\*\*(.+?)\*\*\s*[：:]\s*(.*)$/);
  if (m) return build(m[1], m[2], true);
  // **键名：** 值（冒号在加粗内）
  m = body.match(/^\*\*(.+?)\s*[：:]\s*\*\*\s*(.*)$/);
  if (m) return build(m[1], m[2], true);
  // *键名*：值
  m = body.match(/^\*(.+?)\*\s*[：:]\s*(.*)$/);
  if (m) return build(m[1], m[2], true);
  // 键名：值（无加粗）
  m = body.match(/^([^：:*]{1,30}?)\s*[：:]\s*(.*)$/);
  if (m) return build(m[1], m[2], false);
  return null;
}

/** 构造字段标记正则：键名前不能紧跟字母/数字（避免「来源」误命中「机会来源」） */
function buildMarkerRegex(keys: string[]): RegExp {
  const alt = [...keys]
    .sort((a, b) => b.length - a.length)
    .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  // 键名用命名组 key 捕获，括号后缀用命名组 suffix 捕获（可能是全角「（…）」或半角「(...)」）
  return new RegExp(
    `(?:[-*•]\\s*)?(?<![\\p{L}\\p{N}])(?<key>${alt})(?:(?<suffix>（[^）]*）|\\(([^)]*)\\)))?\\s*[：:]`,
    "gu"
  );
}

interface MarkerMatch {
  index: number;
  length: number;
  key: string;
}

function findMarkers(text: string, aliases: Record<string, string>): MarkerMatch[] {
  const regex = buildMarkerRegex(Object.keys(aliases));
  const out: MarkerMatch[] = [];
  for (const m of text.matchAll(regex)) {
    const index = m.index ?? 0;
    const groups = m.groups ?? {};
    const suffix = groups.suffix ?? "";
    // 半角括号形式：groups.suffix 为 undefined，但 groups[2] 捕获了括号内文本
    const inner = suffix || (groups[2] ? `(${groups[2]})` : "");
    out.push({ index, length: m[0].length, key: normalizeKey(`${groups.key ?? ""}${inner}`) });
  }
  return out;
}

/**
 * 从一段文本中抽取「键：值」字段（支持行内与行间两种形态）。
 * 未识别的键名进 extras，不丢弃。
 */
function extractInlineFields(
  text: string,
  aliases: Record<string, string>
): { fields: Record<string, string>; extras: Record<string, string> } {
  const fields: Record<string, string> = {};
  const extras: Record<string, string> = {};
  const markers = findMarkers(text, aliases);

  for (let i = 0; i < markers.length; i += 1) {
    const marker = markers[i];
    const start = marker.index + marker.length;
    const end = i + 1 < markers.length ? markers[i + 1].index : text.length;
    const value = cleanValue(text.slice(start, end));
    if (!value) continue;
    const canonical = aliases[marker.key];
    if (canonical) fields[canonical] = value;
    else extras[marker.key] = value;
  }
  return { fields, extras };
}

/* ------------------------- 条目抽取 ------------------------- */

interface RawItem {
  kind: "ordered" | "heading";
  /** 条目编号（若原文带编号） */
  num?: number;
  /** 条目首行文本（去掉编号 / 标题标记） */
  head: string;
  /** 条目子内容行 */
  body: string[];
  /** 原始 Markdown */
  rawMarkdown: string;
}

/** 条目起始行：`### 1. 标题` / `### 标题` / `1. 标题` */
function parseItemStart(line: string): { kind: "ordered" | "heading"; num?: number; text: string } | null {
  let m = line.match(/^\s{0,6}#{1,6}\s+(\d+)[.)]\s*(.+)$/);
  if (m) return { kind: "heading", num: parseInt(m[1], 10), text: m[2].trim() };
  m = line.match(/^\s{0,6}#{1,6}\s+(.+)$/);
  if (m) return { kind: "heading", text: m[1].trim() };
  m = line.match(/^\s{0,6}(\d+)[.)]\s+(.+)$/);
  if (m) return { kind: "ordered", num: parseInt(m[1], 10), text: m[2].trim() };
  return null;
}

/** 续行（列表符号行或缩进行） */
function isContinuationLine(line: string): boolean {
  if (/^\s*[-*+]\s+/.test(line)) return true;
  return /^\s+\S/.test(line);
}

/** 普通段落行（既不是条目起始，也不是续行） */
function isPlainParagraphLine(line: string): boolean {
  return line.trim() !== "" && !isContinuationLine(line);
}

/**
 * 抽取章节内的条目：
 * - 支持 `1. 标题` 编号列表（子内容为后续缩进行）
 * - 支持 `### 1. 标题` 三级标题形态
 * - 空行后若跟子内容则仍属于当前条目；若跟新条目或普通段落则结束当前条目
 * - 完全不成条目的普通段落单独收集到 prose（供核心判断散文兜底 / 诊断使用）
 */
function extractItems(raw: string): { items: RawItem[]; prose: string[] } {
  const lines = raw.split("\n");
  const items: RawItem[] = [];
  const prose: string[] = [];

  let current: RawItem | null = null;
  let currentLines: string[] = [];
  let proseBuf: string[] = [];

  const flushItem = () => {
    if (current) {
      current.rawMarkdown = currentLines.join("\n").trim();
      items.push(current);
      current = null;
      currentLines = [];
    }
  };
  const flushProse = () => {
    const text = proseBuf.join("\n").trim();
    if (text) prose.push(text);
    proseBuf = [];
  };
  const nextNonEmpty = (from: number): number => {
    for (let i = from; i < lines.length; i += 1) {
      if (lines[i].trim() !== "") return i;
    }
    return -1;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (line.trim() === "") {
      const next = nextNonEmpty(i + 1);
      if (next === -1) {
        flushItem();
        flushProse();
      } else if (parseItemStart(lines[next])) {
        // 下一行是新条目 → 结束当前条目
        flushItem();
        flushProse();
      } else if (isContinuationLine(lines[next])) {
        // 下一行是子内容 → 当前条目继续（空白行只是排版空隙）
      } else {
        // 下一行是普通段落 → 当前条目结束，段落另算
        flushItem();
        flushProse();
      }
      continue;
    }

    const start = parseItemStart(line);
    if (start) {
      flushItem();
      flushProse();
      current = { kind: start.kind, num: start.num, head: start.text, body: [], rawMarkdown: "" };
      currentLines = [line];
      continue;
    }

    if (current) {
      current.body.push(line);
      currentLines.push(line);
      continue;
    }

    if (isPlainParagraphLine(line)) {
      proseBuf.push(line);
    } else {
      proseBuf.push(line);
    }
  }

  flushItem();
  flushProse();
  return { items, prose };
}

/* ------------------------- 标题 / 字段区域切分 ------------------------- */

interface TitleAndRegion {
  title: string;
  /** 标题之后的字段区域文本 */
  region: string;
}

function splitTitleAndRegion(item: RawItem): TitleAndRegion {
  const bodyText = item.body.join("\n");
  const bold = item.head.match(/\*\*(.+?)\*\*/);
  if (bold && bold.index !== undefined) {
    return {
      title: stripInlineMarkdown(bold[1]),
      region: `${item.head.slice(bold.index + bold[0].length)}\n${bodyText}`,
    };
  }
  return { title: stripInlineMarkdown(item.head), region: bodyText };
}

/* ------------------------- 各板块解析 ------------------------- */

/**
 * 解析单条头条的字段行
 * @param lines 字段行数组
 * @returns 字段映射；未识别的键放入 extra
 */
export function parseHeadlineFields(lines: string[]): HeadlineFields {
  const result: HeadlineFields = { extra: {} };
  if (!Array.isArray(lines)) return result;

  for (const line of lines) {
    const field = parseFieldLine(line);
    if (!field) continue;
    if (!field.bold && !HEADLINE_FIELD_ALIASES[field.key]) {
      // 无加粗且不在别名表内 → 当作普通文本，不污染 extra
      continue;
    }
    const canonical = HEADLINE_FIELD_ALIASES[field.key];
    if (!canonical) {
      result.extra[field.rawKey] = field.value;
      continue;
    }
    if (canonical === "link") {
      result.link = extractBareUrl(field.value) ?? field.value;
    } else {
      (result as unknown as Record<string, unknown>)[canonical] = field.value;
    }
  }
  return result;
}

export interface HeadlineFields {
  source?: string;
  coreFact?: string;
  deepAnalysis?: string;
  impact?: string;
  link?: string;
  /** 未知字段（保留原文，不丢弃） */
  extra: Record<string, string>;
}

/** 从头条章节解析条目：标题 + 字段 */
function parseHeadlines(raw: string): { items: HeadlineItem[]; leftovers: string[] } {
  const { items: rawItems, prose } = extractItems(raw);
  const items: HeadlineItem[] = [];
  const leftovers: string[] = [...prose];

  for (const rawItem of rawItems) {
    const { title, region } = splitTitleAndRegion(rawItem);
    const fieldLines = rawItem.body;
    const fields = parseHeadlineFields(fieldLines);

    // 行内形态兜底：字段全部挤在一行里时，用标记正则再抽一次
    if (Object.keys(fields.extra).length === 0 && !fields.coreFact && !fields.link) {
      const inline = extractInlineFields(region, HEADLINE_FIELD_ALIASES);
      if (inline.fields.coreFact || inline.fields.link || inline.fields.source) {
        Object.assign(fields, inline.fields);
        Object.assign(fields.extra, inline.extras);
      }
    }

    const item: HeadlineItem = {
      index: rawItem.num ?? items.length + 1,
      title: title || `头条 ${items.length + 1}`,
      rawMarkdown: rawItem.rawMarkdown,
    };
    if (fields.source) item.source = fields.source;
    if (fields.coreFact) item.coreFact = fields.coreFact;
    if (fields.deepAnalysis) item.deepAnalysis = fields.deepAnalysis;
    if (fields.impact) item.impact = fields.impact;
    if (fields.link) item.link = fields.link;
    if (Object.keys(fields.extra).length > 0) item.extra = fields.extra;

    // 字段行缺失时，从原文里再兜底找一个 URL，避免出现「无法点击跳转」
    if (!item.link) {
      const url = extractBareUrl(rawItem.rawMarkdown);
      if (url) item.link = url;
    }

    if (!item.title.trim()) {
      leftovers.push(rawItem.rawMarkdown);
      continue;
    }
    items.push(item);
  }

  return { items, leftovers };
}

/** 趋势条目解析（判断依据 / 观点） */
function parseTrends(raw: string): { items: TrendItem[]; leftovers: string[] } {
  const { items: rawItems, prose } = extractItems(raw);
  const items: TrendItem[] = [];
  const leftovers: string[] = [...prose];

  rawItems.forEach((rawItem, i) => {
    const { title, region } = splitTitleAndRegion(rawItem);
    const { fields, extras } = extractInlineFields(region, TREND_FIELD_ALIASES);
    const item: TrendItem = {
      index: rawItem.num ?? i + 1,
      title: title || `趋势 ${i + 1}`,
      rawMarkdown: rawItem.rawMarkdown,
    };
    if (fields.basis) item.basis = fields.basis;
    if (fields.viewpoint) item.viewpoint = fields.viewpoint;
    if (Object.keys(extras).length > 0) item.extra = extras;
    items.push(item);
  });

  return { items, leftovers };
}

/** 机会条目解析（机会来源 / 实现方向 / 潜在价值） */
function parseOpportunities(raw: string): { items: OpportunityItem[]; leftovers: string[] } {
  const { items: rawItems, prose } = extractItems(raw);
  const items: OpportunityItem[] = [];
  const leftovers: string[] = [...prose];

  rawItems.forEach((rawItem, i) => {
    const { title, region } = splitTitleAndRegion(rawItem);
    const { fields, extras } = extractInlineFields(region, OPPORTUNITY_FIELD_ALIASES);
    const item: OpportunityItem = {
      index: rawItem.num ?? i + 1,
      title: title || `机会 ${i + 1}`,
      rawMarkdown: rawItem.rawMarkdown,
    };
    if (fields.source) item.source = fields.source;
    if (fields.direction) item.direction = fields.direction;
    if (fields.value) item.value = fields.value;
    if (Object.keys(extras).length > 0) item.extra = extras;
    items.push(item);
  });

  return { items, leftovers };
}

/** 按句末标点切句（用于核心判断的散文段落兜底） */
function splitSentences(paragraph: string): string[] {
  return paragraph
    .split(/(?<=[。！？!?])\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * 核心判断解析：
 * - 有编号列表 / ### 标题 → 按条目拆分（保留现状）
 * - 无编号（散文段落）→ 按空行分段、段内再按句号边界拆条
 */
function parseCoreJudgments(raw: string): { items: CoreJudgment[]; leftovers: string[] } {
  const { items: rawItems, prose } = extractItems(raw);
  const items: CoreJudgment[] = [];

  if (rawItems.length > 0) {
    for (const rawItem of rawItems) {
      const text = stripInlineMarkdown(rawItem.head);
      const extraBody = stripInlineMarkdown(rawItem.body.join(" "));
      const merged = extraBody ? `${text} ${extraBody}` : text;
      if (merged) items.push({ text: merged });
    }
    return { items, leftovers: [...prose] };
  }

  // 散文段落兜底
  const leftovers: string[] = [];
  for (const paragraph of prose) {
    const sentences = splitSentences(paragraph);
    if (sentences.length === 0) continue;
    for (const sentence of sentences) {
      const text = stripInlineMarkdown(sentence);
      if (text) items.push({ text });
    }
  }
  return { items, leftovers };
}

/* ------------------------- 章节切分 ------------------------- */

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

/* ------------------------- 主入口 ------------------------- */

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

  const diagnostics: ParseDiagnostic = { unparsed: [], emptySections: [] };
  const addUnparsed = (section: string, fragment: string, reason: string) => {
    const text = fragment.trim();
    if (!text) return;
    diagnostics.unparsed.push({
      section,
      fragment: text.length > 500 ? `${text.slice(0, 500)}…` : text,
      reason,
    });
  };

  for (const section of sections) {
    const title = section.title;
    const raw = section.raw;

    // 记录所有章节用于目录
    result.sections.push({ level: 2, title, raw });

    if (/核心判断/.test(title)) {
      const { items, leftovers } = parseCoreJudgments(raw);
      result.coreJudgments = items;
      if (items.length === 0) {
        diagnostics.emptySections.push(title);
        addUnparsed(title, raw, "章节未解析出任何核心判断");
      }
      leftovers.forEach((fragment) => addUnparsed(title, fragment, "内容无法结构化为核心判断条目"));
    } else if (/头条/.test(title)) {
      const { items, leftovers } = parseHeadlines(raw);
      result.headlines = items;
      if (items.length === 0) {
        diagnostics.emptySections.push(title);
        addUnparsed(title, raw, "章节未解析出任何头条");
      }
      leftovers.forEach((fragment) => addUnparsed(title, fragment, "内容无法结构化为头条条目"));
    } else if (/趋势/.test(title)) {
      const { items, leftovers } = parseTrends(raw);
      result.trends = items;
      if (items.length === 0) {
        diagnostics.emptySections.push(title);
        addUnparsed(title, raw, "章节未解析出任何趋势");
      }
      leftovers.forEach((fragment) => addUnparsed(title, fragment, "内容无法结构化为趋势条目"));
    } else if (/机会/.test(title)) {
      const { items, leftovers } = parseOpportunities(raw);
      result.opportunities = items;
      if (items.length === 0) {
        diagnostics.emptySections.push(title);
        addUnparsed(title, raw, "章节未解析出任何机会");
      }
      leftovers.forEach((fragment) => addUnparsed(title, fragment, "内容无法结构化为机会条目"));
    }
  }

  result.diagnostics = diagnostics;
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
