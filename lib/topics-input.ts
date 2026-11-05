// 专题追踪 —— 输入类型与校验（纯函数，无任何 Node/DB 依赖，可被客户端组件复用）
import type { TopicCategory } from "./db-write";

export const TOPIC_CATEGORIES: readonly TopicCategory[] = [
  "公司",
  "模型",
  "产品",
  "技术",
];

/** 专题名长度上限 */
export const TOPIC_NAME_MAX = 100;
/** 描述长度上限 */
export const TOPIC_DESC_MAX = 2000;
/** 关键词数量上限 */
export const TOPIC_KEYWORDS_MAX = 20;
/** 单个关键词长度上限（与 lib/search.ts parseKeywords 一致） */
export const TOPIC_KEYWORD_MAX = 40;

export interface TopicInput {
  name: string;
  category: TopicCategory;
  keywords: string[];
  description: string | null;
}

export type TopicFieldErrors = Partial<
  Record<"name" | "category" | "keywords" | "description", string>
>;

export type TopicValidation =
  | { ok: true; value: TopicInput }
  | { ok: false; fieldErrors: TopicFieldErrors };

/** 是否合法分类 */
export function isTopicCategory(v: unknown): v is TopicCategory {
  return typeof v === "string" && (TOPIC_CATEGORIES as readonly string[]).includes(v);
}

/**
 * 解析关键词输入：按逗号（半角/全角/顿号）与空白切分、去重（忽略大小写）、限长限量。
 * 返回的词保持输入顺序。
 */
export function parseTopicKeywords(raw: string | string[]): string[] {
  const text = Array.isArray(raw) ? raw.join(",") : raw;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of text.split(/[,，、\s　]+/)) {
    const k = part.trim().slice(0, TOPIC_KEYWORD_MAX);
    if (!k) continue;
    const key = k.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(k);
    if (out.length >= TOPIC_KEYWORDS_MAX) break;
  }
  return out;
}

/** 统一校验（服务端二次校验与前端即时校验共用，不信任前端） */
export function validateTopicInput(raw: {
  name?: unknown;
  category?: unknown;
  keywords?: unknown;
  description?: unknown;
}): TopicValidation {
  const fieldErrors: TopicFieldErrors = {};

  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) fieldErrors.name = "请填写专题名称";
  else if (name.length > TOPIC_NAME_MAX) fieldErrors.name = `专题名称不能超过 ${TOPIC_NAME_MAX} 字`;

  let category: TopicCategory = "公司";
  if (!isTopicCategory(raw.category)) fieldErrors.category = "请选择分类（公司 / 模型 / 产品 / 技术）";
  else category = raw.category;

  let keywords: string[] = [];
  if (typeof raw.keywords === "string") keywords = parseTopicKeywords(raw.keywords);
  else if (Array.isArray(raw.keywords))
    keywords = parseTopicKeywords(raw.keywords.filter((k): k is string => typeof k === "string"));
  if (keywords.length > TOPIC_KEYWORDS_MAX)
    fieldErrors.keywords = `关键词最多 ${TOPIC_KEYWORDS_MAX} 个`;

  const descriptionRaw = typeof raw.description === "string" ? raw.description.trim() : "";
  if (descriptionRaw.length > TOPIC_DESC_MAX)
    fieldErrors.description = `描述不能超过 ${TOPIC_DESC_MAX} 字`;
  const description = descriptionRaw || null;

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return { ok: true, value: { name, category, keywords, description } };
}
