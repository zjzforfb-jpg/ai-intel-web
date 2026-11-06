// 实体抽取 —— 纯函数，零 LLM、零 IO
//
// 契约：docs/phase3-stageB-interface.md 第 3 节
// - 数据源只有 reportMarkdown，不调用任何模型、不引入外部数据；
// - 实体来源是受控词典 ENTITY_VARIANTS（lib/normalize.ts，34 条），
//   canonical 与全部 variants 都参与大小写不敏感匹配；
// - 每个 mention 必须定位到「今日必读头条」中的具体一条，
//   定位不到的匹配直接丢弃（不生成 mention）；
// - context 取实体所在那一行原文，去 markdown 标记后截断 200 字；
// - source_url 只从该头条的「原文链接」取，取不到为 null，绝不编造；
// - importance_score 用启发式规则（见 computeImportanceScore），1..10。
//
// 本文件严禁 import pg / fs / http 等任何 IO 模块，同输入必须同输出。
import { ENTITY_VARIANTS } from "./normalize";
import { parseReport } from "./markdown-parser";

/** 实体类型枚举（与 entities.entity_type 的 CHECK 约束一致） */
export type EntityType =
  | "company"
  | "person"
  | "ai_product"
  | "technology"
  | "open_source"
  | "organization"
  | "unknown";

export const ENTITY_TYPES: readonly EntityType[] = [
  "company",
  "person",
  "ai_product",
  "technology",
  "open_source",
  "organization",
  "unknown",
];

/**
 * 规范名 → 实体类型（契约 §3.4 映射表，主控提供）
 * 表里没有的 canonical 一律 'unknown'，不猜测。
 */
export const ENTITY_TYPE_MAP: Readonly<Record<string, EntityType>> = {
  // company
  openai: "company",
  anthropic: "company",
  google: "company",
  nvidia: "company",
  facebook: "company",
  microsoft: "company",
  amazon: "company",
  apple: "company",
  deepseek: "company",
  github: "company",
  "hugging face": "company",
  // ai_product
  gpt: "ai_product",
  gemini: "ai_product",
  "cosmos 3": "ai_product",
  "claude code": "ai_product",
  codex: "ai_product",
  copilot: "ai_product",
  cursor: "ai_product",
  sora: "ai_product",
  midjourney: "ai_product",
  perplexity: "ai_product",
  openrouter: "ai_product",
  qwen: "ai_product",
  llama: "ai_product",
  rivet: "ai_product",
  // technology
  mcp: "technology",
  langchain: "technology",
  kubernetes: "technology",
  postgres: "technology",
  redis: "technology",
  docker: "technology",
  pii: "technology",
  编程agent: "technology",
  // organization
  aws: "organization",
};

/** 契约 §3.1 输入 */
export interface ExtractInput {
  /** "YYYY-MM-DD" */
  reportDate: string;
  reportMarkdown: string;
}

/** 契约 §3.2 输出 */
export interface ExtractedMention {
  canonical: string;
  normalizedName: string;
  entityType: EntityType;
  /** 本次命中的别名（小写），至少 1 条 */
  aliases: string[];
  reportDate: string;
  sourceTitle: string | null;
  sourceUrl: string | null;
  /** ≤200 字，实体所在那一行原文（已去 markdown 标记） */
  context: string;
  importanceScore: number;
}

/** context 最大字数（契约 §3.3 第 4 条） */
export const CONTEXT_MAX_LENGTH = 200;

/* ==================== 归一化与类型 ==================== */

/**
 * 实体归一化名：小写 + 去空格与标点。
 * 只保留字母、数字与中日韩字符，保证「Claude Code」→「claudecode」、
 * 「Cosmos 3」→「cosmos3」、「Hugging Face」→「huggingface」。
 */
export function normalizeEntityName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g, "");
}

/** 规范名 → 类型；映射表未覆盖的落 'unknown' */
export function entityTypeOf(canonical: string): EntityType {
  return ENTITY_TYPE_MAP[canonical] ?? "unknown";
}

/* ==================== 词典匹配 ==================== */

interface CompiledVariant {
  canonical: string;
  /** 小写别名（用于 aliases 输出） */
  variant: string;
  source: string;
  flags: string;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 编译单个别名：
 * - 拉丁字母/数字开头时加左边界，结尾同理加右边界，
 *   避免「gpt」命中「gptx」、「meta」命中「metadata」；
 * - 中文别名不加边界（中英文之间没有词边界概念）。
 */
function compileVariant(canonical: string, variant: string): CompiledVariant {
  const lower = variant.toLowerCase();
  const escaped = escapeRegExp(lower);
  const left = /^[a-z0-9]/.test(lower) ? "(?<![a-z0-9])" : "";
  const right = /[a-z0-9]$/.test(lower) ? "(?![a-z0-9])" : "";
  return { canonical, variant: lower, source: `${left}${escaped}${right}`, flags: "gi" };
}

const COMPILED: readonly CompiledVariant[] = ENTITY_VARIANTS.flatMap((e) =>
  e.variants.map((v) => compileVariant(e.canonical, v))
);

interface Span {
  start: number;
  end: number;
}

function findSpans(text: string, v: CompiledVariant): Span[] {
  if (!text) return [];
  const re = new RegExp(v.source, v.flags);
  const spans: Span[] = [];
  let m: RegExpExecArray | null = re.exec(text);
  while (m !== null) {
    spans.push({ start: m.index, end: m.index + m[0].length });
    if (m[0].length === 0) re.lastIndex += 1;
    m = re.exec(text);
  }
  return spans;
}

/** 合并重叠区间（「GPT-4」同时命中 gpt 与 gpt-4 时只算 1 次出现） */
function mergeSpans(spans: Span[]): Span[] {
  if (spans.length === 0) return [];
  const sorted = [...spans].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Span[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i += 1) {
    const last = out[out.length - 1];
    const cur = sorted[i];
    if (cur.start <= last.end) {
      if (cur.end > last.end) last.end = cur.end;
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

interface EntityHit {
  canonical: string;
  /** 命中的别名（小写，按词典顺序去重） */
  aliases: string[];
  /** 首次出现位置（用于稳定排序） */
  firstIndex: number;
  occurrenceCount: number;
}

/**
 * 在文本中匹配全部受控词典实体。
 * 返回值按词典顺序（ENTITY_VARIANTS 顺序）排列，保证确定性。
 */
function matchEntities(text: string): Map<string, EntityHit> {
  const byCanonical = new Map<string, EntityHit>();
  if (!text) return byCanonical;

  for (const v of COMPILED) {
    const spans = findSpans(text, v);
    if (spans.length === 0) continue;
    const merged = mergeSpans(spans);
    const existed = byCanonical.get(v.canonical);
    if (!existed) {
      byCanonical.set(v.canonical, {
        canonical: v.canonical,
        aliases: [v.variant],
        firstIndex: merged[0].start,
        occurrenceCount: merged.length,
      });
      continue;
    }
    if (!existed.aliases.includes(v.variant)) existed.aliases.push(v.variant);
    if (merged[0].start < existed.firstIndex) existed.firstIndex = merged[0].start;
    // 同一 canonical 的多个别名区间可能互相重叠（gpt / gpt-4），统一再合并一次
    existed.occurrenceCount += merged.length;
  }

  // 同一 canonical 下不同别名重叠时，出现次数会重复计数 → 用全文再精确统计一次
  for (const hit of byCanonical.values()) {
    const spans: Span[] = [];
    for (const v of COMPILED) {
      if (v.canonical !== hit.canonical) continue;
      spans.push(...findSpans(text, v));
    }
    hit.occurrenceCount = mergeSpans(spans).length;
  }

  // 按词典声明顺序返回（Map 保持插入顺序，但别名补齐顺序不受影响）
  const ordered = new Map<string, EntityHit>();
  for (const e of ENTITY_VARIANTS) {
    const hit = byCanonical.get(e.canonical);
    if (hit) ordered.set(e.canonical, hit);
  }
  return ordered;
}

/* ==================== context ==================== */

/** 去掉行内 markdown 标记，只保留可读文本 */
function stripMarkdownLine(line: string): string {
  return line
    .replace(/^#{1,6}\s*/, "")
    .replace(/^>\s*/, "")
    .replace(/^[-*+]\s+/, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** 实体是否出现在这一行（用全文同一套匹配规则） */
function lineHasEntity(line: string, canonical: string): boolean {
  for (const v of COMPILED) {
    if (v.canonical !== canonical) continue;
    if (findSpans(line, v).length > 0) return true;
  }
  return false;
}

/**
 * 取实体所在那一行原文。
 * 优先级：「核心事实」行 > 其他正文行（非来源/链接）> 任一正文行 > 标题行，
 * 让 context 尽量承载事实而非「来源及发布时间」这类低信息量行。
 * 统一去 markdown 并截断到 200 字。
 */
function pickContext(rawMarkdown: string, canonical: string): string | null {
  const lines = rawMarkdown.split("\n");
  const matched: Array<{ text: string; heading: boolean }> = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    if (!lineHasEntity(line, canonical)) continue;
    matched.push({ text: stripMarkdownLine(line), heading: /^\s*#{1,6}\s/.test(line) });
  }
  if (matched.length === 0) return null;

  const body = matched.filter((m) => !m.heading);
  const coreFact = body.find((m) => /^核心事实/.test(m.text));
  const plain = body.find(
    (m) => !/^(来源|链接|原文链接|网址)/.test(m.text) && !/^https?:\/\//.test(m.text)
  );
  const chosen = coreFact ?? plain ?? body[0] ?? matched[0];
  return chosen.text.slice(0, CONTEXT_MAX_LENGTH);
}

/* ==================== 重要度 ==================== */

export interface ImportanceFlags {
  /** 是否出现在任一「今日必读头条」标题中 */
  inHeadlineTitle: boolean;
  /** 是否出现在「今日核心判断」章节中 */
  inCoreJudgment: boolean;
  /** 全文出现次数（重叠区间已合并） */
  occurrences: number;
}

/**
 * importance_score（契约 §3.3 第 6 条）：
 * 基础 1；头条标题 +4；核心判断 +3；全文 ≥3 次 +2，≥6 次再 +1；上限 10。
 */
export function computeImportanceScore(flags: ImportanceFlags): number {
  let score = 1;
  if (flags.inHeadlineTitle) score += 4;
  if (flags.inCoreJudgment) score += 3;
  if (flags.occurrences >= 3) score += 2;
  if (flags.occurrences >= 6) score += 1;
  return Math.min(10, Math.max(1, score));
}

/* ==================== 主入口 ==================== */

/**
 * 从日报 markdown 抽取实体提及。
 *
 * 只产出「能定位到具体头条」的 mention：每个 (实体, 头条) 最多 1 条。
 * 解析失败（无头条）时返回空数组，不抛异常。
 */
export function extractEntityMentions(input: ExtractInput): ExtractedMention[] {
  const markdown = input.reportMarkdown ?? "";
  if (!markdown.trim()) return [];

  const parsed = parseReport(markdown);
  const headlines = parsed?.headlines ?? [];
  if (headlines.length === 0) return [];

  const coreText = (parsed?.coreJudgments ?? []).map((c) => c.text).join("\n");
  const coreHits = matchEntities(coreText);
  // 全文出现次数用于重要度加分
  const fullHits = matchEntities(markdown);

  // 聚合粒度：一篇日报里一个实体只产出一条提及。
  //
  // 为什么不是「一个头条一条」：实体提及的唯一键是 (entity_id, report_id)，
  // 同一实体在同一篇日报里出现多次也只该算一次提及；而且日报重跑时 LLM 会
  // 重写标题，若按头条拆条，重跑就会不断累积重复行。
  //
  // 选哪条头条作为来源：优先选「实体出现在标题里」的那条（信号最强），
  // 否则取第一条能定位到原文行的。
  interface Picked {
    canonical: string;
    aliases: Set<string>;
    sourceTitle: string | null;
    sourceUrl: string | null;
    context: string;
    titleHit: boolean;
    occurrenceCount: number;
  }
  const picked = new Map<string, Picked>();

  for (const headline of headlines) {
    const title = headline.title?.trim() ?? "";
    const titleHits = matchEntities(title);
    const bodyHits = matchEntities(headline.rawMarkdown);

    for (const [canonical, hit] of bodyHits) {
      const context = pickContext(headline.rawMarkdown, canonical);
      // 定位不到原文行 → 证据不足，丢弃
      if (!context) continue;

      const isTitleHit = titleHits.has(canonical);
      const existing = picked.get(canonical);

      // aliases 是实体级属性：把全报告出现过的别名都并进去
      if (existing) {
        for (const a of hit.aliases) existing.aliases.add(a);
      }

      // 已有记录且已命中标题 → 不再替换来源
      if (existing && existing.titleHit) continue;
      // 新候选没命中标题、但已有记录也没命中 → 保留先到的（顺序稳定，便于测试）
      if (existing && !isTitleHit) continue;

      picked.set(canonical, {
        canonical,
        aliases: existing ? existing.aliases : new Set(hit.aliases),
        sourceTitle: title || null,
        sourceUrl: headline.link?.trim() || null,
        context,
        titleHit: isTitleHit,
        occurrenceCount: fullHits.get(canonical)?.occurrenceCount ?? hit.occurrenceCount,
      });
    }
  }

  const out: ExtractedMention[] = [];
  for (const p of picked.values()) {
    out.push({
      canonical: p.canonical,
      normalizedName: normalizeEntityName(p.canonical),
      entityType: entityTypeOf(p.canonical),
      aliases: Array.from(p.aliases),
      reportDate: input.reportDate,
      sourceTitle: p.sourceTitle,
      sourceUrl: p.sourceUrl,
      context: p.context,
      importanceScore: computeImportanceScore({
        // 「出现在任意一条头条标题里」即算命中标题，与 n8n 侧判定一致
        inHeadlineTitle: p.titleHit,
        inCoreJudgment: coreHits.has(p.canonical),
        occurrences: p.occurrenceCount,
      }),
    });
  }

  return out;
}
