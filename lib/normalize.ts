// 轻量文本归一化 —— 为语义去重提供统一的文本特征
//
// 设计约束（重要，主控在阶段 D 需要把本文件逐函数移植到 n8n 的 Code 节点）：
// - 本文件严禁 import 任何 Node 内置模块或第三方库，只用字符串与正则运算；
// - 不使用 Intl.Segmenter 等环境相关 API，中文切分采用「领域词典最长匹配 + 2~4 字片段回退」；
// - 所有可调参数（实体变体表、领域词典、主题分类表、停用词表）都以常量导出，便于 n8n 侧同步。
//
// 归一化流程（与契约 docs/phase2-stageB-interface.md 第 3.1 节规则清单一一对应）：
//   全半角 → 中英标点统一 → 英文小写 → 空格收敛 → 营销修饰词去除
//   → 无意义前缀去除 → 实体名变体合并 → 剔除标点
//
// 提取维度：
//   - keywords：领域词典命中的规范词（权重 1.0）+ 未登录中文 2~4 字片段 / 英文词（权重 0.5）
//   - entities：实体变体表命中的规范名（公司 / 产品 / 技术名）
//   - topics：主题分类表命中的主题标签（用于「同主题」判定）

/** 归一化后的文本特征 */
export interface NormalizedText {
  /** 完全归一化后的小写文本（用于精确比较） */
  text: string;
  /** 提取的关键词集合（已去重、去停用词） */
  keywords: string[];
  /** 提取的重要实体（公司/产品/技术名等） */
  entities: string[];
  /** 提取的主题标签（用于主题相似度） */
  topics: string[];
}

/* ==================== 词典与词表（真源在 lib/lexicon/tables.ts） ==================== */
//
// 这些表曾经直接写在本文件里，同时在 n8n 的两个 Code 节点里各存一份手抄副本，
// 三处靠人维护，已经实际漂移过（STOP_WORDS 在 n8n 侧 119 条 vs 此处 185 条）。
// 现在唯一物理位置是 lib/lexicon/tables.ts，本文件只做转出，保持对外 API 不变。
//
// 改词典请改 lib/lexicon/tables.ts，改完跑：
//   npx tsx scripts/verify/lexicon-drift.mts --source=ts
// 然后重新 apply 两个 n8n 脚本（phase2-n8n-patch / phase3-n8n-entities）。

import {
  ENTITY_VARIANTS,
  DOMAIN_TERMS,
  TOPIC_CATEGORIES,
  STOP_WORDS,
  WEAK_KEYWORDS,
  MEANINGLESS_PREFIXES,
  PREFIX_EXCEPTIONS,
  MARKETING_MODIFIERS,
} from "./lexicon/tables";

export {
  ENTITY_VARIANTS,
  DOMAIN_TERMS,
  TOPIC_CATEGORIES,
  STOP_WORDS,
  WEAK_KEYWORDS,
  MEANINGLESS_PREFIXES,
  MARKETING_MODIFIERS,
};

export type { EntityVariant, DomainTerm, TopicCategory } from "./lexicon/tables";











/* ==================== 内部词典索引 ==================== */

interface DictEntry {
  term: string;
  kind: "entity" | "term";
}

const DICT = new Map<string, DictEntry>();
let MAX_ALIAS_LEN = 1;

function addAlias(alias: string, term: string, kind: "entity" | "term"): void {
  if (!alias) return;
  const key = alias.toLowerCase();
  const existed = DICT.get(key);
  // 实体优先于普通领域词
  if (existed && existed.kind === "entity") return;
  DICT.set(key, { term, kind });
  if (key.length > MAX_ALIAS_LEN) MAX_ALIAS_LEN = key.length;
}

for (const e of ENTITY_VARIANTS) {
  for (const v of e.variants) addAlias(v, e.canonical, "entity");
}
for (const t of DOMAIN_TERMS) {
  for (const a of t.aliases) addAlias(a, t.term, "term");
}

/** 主题分类 → 触发词集合 */
const TOPIC_TRIGGER_MAP = new Map<string, Set<string>>();
for (const c of TOPIC_CATEGORIES) {
  TOPIC_TRIGGER_MAP.set(c.tag, new Set(c.triggers));
}

/** 实体 → 强相关实体（双向展开，便于任一侧查询） */
const ENTITY_RELATED_MAP = new Map<string, Set<string>>();
function linkRelated(a: string, b: string): void {
  const setA = ENTITY_RELATED_MAP.get(a) ?? new Set<string>();
  setA.add(b);
  ENTITY_RELATED_MAP.set(a, setA);
  const setB = ENTITY_RELATED_MAP.get(b) ?? new Set<string>();
  setB.add(a);
  ENTITY_RELATED_MAP.set(b, setB);
}
for (const e of ENTITY_VARIANTS) {
  for (const r of e.related ?? []) linkRelated(e.canonical, r);
}

const STOP_WORD_SET = new Set(STOP_WORDS);
const WEAK_KEYWORD_SET = new Set(WEAK_KEYWORDS);
/** 片段切分字符：中文单字停用词 */
const FRAGMENT_CUT_CHARS = new Set(
  STOP_WORDS.filter((w) => w.length === 1 && /[\u3400-\u9fff]/.test(w))
);

/* ==================== 基础归一化工具 ==================== */

const CJK_PATTERN = "[\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff]";
const RE_CJK = new RegExp(CJK_PATTERN);
const RE_LATIN_NUM = /[a-z0-9]/;

function isCjk(ch: string): boolean {
  return ch.length > 0 && RE_CJK.test(ch);
}

function isLatinNum(ch: string): boolean {
  return ch.length > 0 && RE_LATIN_NUM.test(ch);
}

/** 全角 → 半角（含全角空格与全角标点、数字） */
export function toHalfWidth(input: string): string {
  let out = "";
  for (const ch of input) {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 0x3000) {
      out += " ";
      continue;
    }
    if (code >= 0xff01 && code <= 0xff5e) {
      out += String.fromCharCode(code - 0xfee0);
      continue;
    }
    out += ch;
  }
  return out;
}

/** 中英标点混用统一（契约 3.1 节：全角标点 → 半角，冒号/等号/逗号统一） */
const PUNCT_MAP: Readonly<Record<string, string>> = {
  "、": ",",
  "。": ".",
  "，": ",",
  "；": ";",
  "：": ":",
  "！": "!",
  "？": "?",
  "（": "(",
  "）": ")",
  "【": "[",
  "】": "]",
  "《": "<",
  "》": ">",
  "「": '"',
  "」": '"',
  "『": '"',
  "』": '"',
  "“": '"',
  "”": '"',
  "‘": "'",
  "’": "'",
  "—": "-",
  "–": "-",
  "―": "-",
  "−": "-",
  "～": "~",
  "·": "-",
  "•": "-",
  "・": "-",
  "…": "...",
  "‥": "...",
  "∶": ":",
  "＝": "=",
};

/** 标点统一：把各类中文标点映射成 ASCII 标点 */
export function unifyPunctuation(input: string): string {
  let out = "";
  for (const ch of input) {
    out += PUNCT_MAP[ch] ?? ch;
  }
  return out;
}

/** 空格收敛：中文字符间空格全部去除；中文与英文/数字间空格去除；英文单词间保留单空格 */
export function tightenSpaces(input: string): string {
  let out = input;
  let prev = "";
  let guard = 0;
  while (prev !== out && guard < 8) {
    prev = out;
    out = out.replace(new RegExp(`(${CJK_PATTERN})\\s+(?=${CJK_PATTERN})`, "g"), "$1");
    out = out.replace(new RegExp(`(${CJK_PATTERN})\\s+(?=[a-z0-9])`, "g"), "$1");
    out = out.replace(new RegExp(`([a-z0-9])\\s+(?=${CJK_PATTERN})`, "g"), "$1");
    guard++;
  }
  // 标点两侧的空格一律收敛为「标点紧贴文字」：
  // 全角冒号与半角冒号在归一化后必须得到同一个结果，
  // 否则「ＡＩ Agent：测试」与「AI Agent: 测试」会算出不同的 text。
  out = out.replace(/\s+([,.:;!?)\]}])/g, "$1");
  out = out.replace(/([([{])\s+/g, "$1");
  // 标点前的空格也要去掉（含中英混排时英文侧的空格）
  out = out.replace(/([,.:;!?)\]}])\s+(?=[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaffa-z0-9])/g, "$1");
  return out.replace(/\s+/g, " ").trim();
}

/** 剔除营销修饰词（整篇） */
export function stripMarketingModifiers(input: string): string {
  let out = input;
  for (const w of MARKETING_MODIFIERS) {
    if (out.includes(w)) out = out.split(w).join("");
  }
  return out;
}

/** 标题开头的装饰性标点（!/！?？.。、,，:：等），剥离前缀前先去掉 */
const LEADING_DECORATION = /^[\s!！?？.。、,，:：;；~～\-—_"'“”‘’《》【】()（）\[\]]+/;

/**
 * 剔除标题开头的无意义前缀（可连续剔除）
 * 前置处理：先剥掉开头的装饰性标点，
 * 否则「！如何做Agent工具」这类「标点 + 前缀」的写法会绕过前缀剥离。
 */
export function stripMeaninglessPrefixes(input: string): string {
  let out = input.trim().replace(LEADING_DECORATION, "").trim();
  let changed = true;
  let guard = 0;
  while (changed && guard < 12) {
    changed = false;
    guard++;
    for (const p of MEANINGLESS_PREFIXES) {
      if (!out.startsWith(p)) continue;
      const next = out.charAt(p.length);
      const exceptions = PREFIX_EXCEPTIONS[p];
      if (exceptions && next && exceptions.includes(next)) continue;
      out = out.slice(p.length).trim();
      changed = true;
      break;
    }
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 实体变体合并：把所有变体统一替换成规范名（大小写不敏感匹配） */
export function mergeEntityVariants(input: string): string {
  let out = input;
  // 长变体优先，避免「claude code」被更短的变体抢先匹配
  const all: Array<{ variant: string; canonical: string }> = [];
  for (const e of ENTITY_VARIANTS) {
    for (const v of e.variants) all.push({ variant: v.toLowerCase(), canonical: e.canonical });
  }
  all.sort((a, b) => b.variant.length - a.variant.length);
  for (const { variant, canonical } of all) {
    // 大小写不敏感的前置判断，避免「Meta」「OPEN AI」等写法漏匹配
    if (!out.toLowerCase().includes(variant)) continue;
    const escaped = escapeRegExp(variant);
    // 纯拉丁变体加词边界；含中文的变体不加（中文与英文之间没有词边界概念）
    // 正则带 i 标志，保证「Meta」与「meta」都能命中
    const pattern = RE_CJK.test(variant)
      ? new RegExp(escaped, "gi")
      : new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "gi");
    out = out.replace(pattern, canonical);
  }
  return out;
}

/** 基础归一化：全半角 → 标点统一 → 小写 → 空格 → 营销词 → 前缀 → 实体合并 → 剔除标点 */
function basicNormalize(input: unknown): string {
  if (input == null) return "";
  let s = typeof input === "string" ? input : String(input);
  if (!s.trim()) return "";
  s = toHalfWidth(s);
  s = unifyPunctuation(s);
  s = s.toLowerCase();
  s = tightenSpaces(s);
  s = stripMarketingModifiers(s);
  s = stripMeaninglessPrefixes(s);
  s = mergeEntityVariants(s);
  // 剔除剩余标点，只保留字母数字与中文
  s = s.replace(new RegExp(`[^a-z0-9${CJK_PATTERN}\\s]`, "g"), " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

/* ==================== 切分 ==================== */

export interface TokenizeResult {
  tokens: string[];
  entities: string[];
}

/**
 * 领域词典最长匹配切分（无外部依赖，可等价移植到 n8n）：
 * - 命中实体别名 → 产出实体规范名；
 * - 命中领域词别名 → 产出规范词；
 * - 未命中的英文串 → 作为英文词产出（长度 ≥ 2）；
 * - 未命中的中文串 → 按单字停用词切分后，取 2~4 字片段产出（更长的丢弃，避免稀释相似度）。
 */
export function tokenize(input: unknown): TokenizeResult {
  const text = basicNormalize(input);
  const tokens: string[] = [];
  const entities: string[] = [];
  if (!text) return { tokens, entities };

  let i = 0;
  let cjkRun = "";

  const flushCjk = (): void => {
    if (!cjkRun) return;
    const run = cjkRun;
    cjkRun = "";
    for (const seg of splitByCutChars(run)) {
      if (seg.length >= 2 && seg.length <= 4 && !STOP_WORD_SET.has(seg)) tokens.push(seg);
    }
  };

  while (i < text.length) {
    const firstCh = text.charAt(i);
    const prevCh = i > 0 ? text.charAt(i - 1) : "";
    // 拉丁词需要词边界；中文词不需要（中文与英文之间没有词边界概念）
    const canStartHere = isLatinNum(firstCh) ? !isLatinNum(prevCh) : true;
    let matched = false;
    if (canStartHere) {
      const maxLen = Math.min(MAX_ALIAS_LEN, text.length - i);
      for (let len = maxLen; len >= 1; len--) {
        const slice = text.slice(i, i + len);
        const hit = DICT.get(slice);
        if (!hit) continue;
        flushCjk();
        tokens.push(hit.term);
        if (hit.kind === "entity") entities.push(hit.term);
        i += len;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    if (isCjk(firstCh)) {
      cjkRun += firstCh;
      i++;
      continue;
    }
    flushCjk();
    if (isLatinNum(firstCh)) {
      let j = i;
      while (
        j < text.length &&
        (isLatinNum(text.charAt(j)) || text.charAt(j) === "." || text.charAt(j) === "_" || text.charAt(j) === "-")
      ) {
        j++;
      }
      const word = text.slice(i, j).replace(/[._-]+$/, "");
      if (word.length >= 2) tokens.push(word);
      i = j;
      continue;
    }
    i++;
  }
  flushCjk();
  return { tokens, entities };
}

/** 按单字停用词切分中文片段 */
function splitByCutChars(run: string): string[] {
  const out: string[] = [];
  let buf = "";
  for (const ch of run) {
    if (FRAGMENT_CUT_CHARS.has(ch)) {
      if (buf) out.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf) out.push(buf);
  return out;
}

/* ==================== 对外接口 ==================== */

/**
 * 轻量归一化：大小写、空格标点、中英混合、无意义前缀、营销修饰词
 * 不依赖 embedding / 向量库 / 外部 API
 */
export function normalizeText(input: string): NormalizedText {
  const text = basicNormalize(input);
  const { tokens, entities } = tokenize(input);
  const keywords = dedupe(tokens.filter((t) => !STOP_WORD_SET.has(t)));
  const entityList = dedupe(entities);
  const topics = topicsOf(keywords, entityList);
  return { text, keywords, entities: entityList, topics };
}

/**
 * 仅做标题级归一化，返回可直接用于唯一性比较的字符串
 * 规则：去营销前缀、去标点空白、统一全半角、统一大小写、实体名变体合并
 */
export function normalizeTitle(title: string): string {
  return basicNormalize(title).replace(/\s+/g, "");
}

/**
 * 提取重要实体（公司名、产品名、技术名等）
 */
export function extractEntities(text: string): string[] {
  const { entities } = tokenize(text);
  return dedupe(entities);
}

/**
 * 提取关键词（中文按领域词典切分 + 未登录片段 2~4 字 + 英文按词切分，去停用词）
 */
export function extractKeywords(text: string): string[] {
  const { tokens } = tokenize(text);
  return dedupe(tokens.filter((t) => !STOP_WORD_SET.has(t)));
}

/**
 * 提取主题标签（用于「同主题」判定）
 */
export function extractTopics(text: string): string[] {
  const { tokens, entities } = tokenize(text);
  const keywords = dedupe(tokens.filter((t) => !STOP_WORD_SET.has(t)));
  return topicsOf(keywords, dedupe(entities));
}

/** 实体弱关联关系查询（共享 related 时视为弱实体命中） */
export function relatedEntities(entity: string): string[] {
  return Array.from(ENTITY_RELATED_MAP.get(entity) ?? []);
}

/** 关键词权重：领域词 / 实体 = 1.0，通用词 = 0.5 */
export function keywordWeight(keyword: string): number {
  return WEAK_KEYWORD_SET.has(keyword) ? 0.5 : 1;
}

function dedupe(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of list) {
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function topicsOf(keywords: string[], entities: string[]): string[] {
  const pool = new Set<string>([...keywords, ...entities]);
  const tags: string[] = [];
  for (const c of TOPIC_CATEGORIES) {
    const triggers = TOPIC_TRIGGER_MAP.get(c.tag);
    if (!triggers) continue;
    for (const t of pool) {
      if (triggers.has(t)) {
        tags.push(c.tag);
        break;
      }
    }
  }
  return tags;
}
