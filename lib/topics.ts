// 专题追踪 —— 读查询（只读账号）
// 红线：全部 SQL 参数化；关键词数组经 unnest($1::text[]) 绑定；
// ILIKE 通配符（% _ \）在 SQL 内 replace() 转义，按字面匹配；
// 不用 to_tsvector（中文不分词，已实测失败），沿用 lib/db.ts searchArchive 的 ILIKE 方案。
import { getReadPool } from "./db";
import type { TopicCategory, TopicRow } from "./db-write";

// 输入类型与校验为纯函数，独立在 topics-input.ts（可被客户端组件安全引用）
export {
  TOPIC_CATEGORIES,
  TOPIC_NAME_MAX,
  TOPIC_DESC_MAX,
  TOPIC_KEYWORDS_MAX,
  TOPIC_KEYWORD_MAX,
  isTopicCategory,
  parseTopicKeywords,
  validateTopicInput,
} from "./topics-input";
export type {
  TopicInput,
  TopicValidation,
  TopicFieldErrors,
} from "./topics-input";

/** 相关日报单页最大返回条数 */
export const RELATED_REPORTS_LIMIT = 50;

// ---------- 展示类型 ----------

export interface TopicWithCount extends TopicRow {
  /** 命中该专题全部关键词的日报篇数 */
  related_count: number;
}

export interface TopicKeywordStat {
  keyword: string;
  /** 该关键词命中（标题或正文）的日报篇数 */
  hits: number;
}

export interface RelatedReport {
  id: number;
  report_date: string;
  title: string;
  generated_at: string | null;
  total_articles: number | null;
  headline_count: number | null;
  status: string | null;
  /** 仅服务端用于生成摘要片段，不下发前端 */
  report_markdown: string | null;
  /** 命中标题的关键词（保持专题关键词顺序） */
  title_hits: string[];
  /** 仅命中正文的关键词 */
  body_hits: string[];
}

export interface TopicRelated {
  /** 命中全部关键词的日报总篇数 */
  total: number;
  items: RelatedReport[];
}

// ---------- SQL 片段 ----------

/**
 * 单个关键词 k 的 ILIKE 字面匹配转义（与 lib/db.ts searchArchive 完全一致）：
 * 先把 \ 加倍，再转义 % 与 _，两侧补 % 通配。
 */
const K_ESCAPED =
  "replace(replace(replace(k, E'\\\\', E'\\\\\\\\'), '%', E'\\\\%'), '_', E'\\\\_')";
// 统一限定到 daily_reports 的别名 d（每个查询里日报表都别名为 d）
const K_TITLE_HIT = `d.title ILIKE '%' || ${K_ESCAPED} || '%'`;
const K_BODY_HIT = `d.report_markdown ILIKE '%' || ${K_ESCAPED} || '%'`;

/** 多关键词 AND：每个关键词都必须命中标题或正文（关键词为空时恒为假，不关联任何日报） */
const AND_ALL_KEYWORDS = `cardinality($1::text[]) > 0 AND NOT EXISTS (
        SELECT 1 FROM unnest($1::text[]) AS kw(k)
        WHERE NOT (${K_TITLE_HIT} OR ${K_BODY_HIT})
      )`;

// ---------- 读查询（getReadPool，仅 SELECT） ----------

/**
 * 专题列表（含相关日报数），可按分类筛选。
 * 相关日报数 = 同时命中该专题全部关键词（AND）的日报篇数；无关键词的专题计 0。
 */
export async function listTopics(
  category: TopicCategory | null = null
): Promise<TopicWithCount[]> {
  const pool = getReadPool();
  const client = await pool.connect();
  try {
    const res = await client.query<TopicWithCount>(
      `SELECT t.id::int AS id, t.name, t.category, t.keywords, t.description,
              t.created_at::text AS created_at, t.updated_at::text AS updated_at,
              (SELECT count(*)::int FROM daily_reports d
                WHERE cardinality(t.keywords) > 0
                  AND NOT EXISTS (
                    SELECT 1 FROM unnest(t.keywords) AS kw(k)
                    WHERE NOT (${K_TITLE_HIT} OR ${K_BODY_HIT})
                  )) AS related_count
       FROM topics t
       WHERE ($1::text IS NULL OR t.category = $1)
       ORDER BY t.updated_at DESC, t.id DESC`,
      [category]
    );
    return res.rows;
  } finally {
    client.release();
  }
}

/** 各分类的专题数（用于筛选标签计数，未出现的分类计 0） */
export async function getCategoryCounts(): Promise<Record<TopicCategory, number>> {
  const pool = getReadPool();
  const client = await pool.connect();
  try {
    const res = await client.query<{ category: TopicCategory; n: number }>(
      `SELECT category, count(*)::int AS n FROM topics GROUP BY category`
    );
    const out = { 公司: 0, 模型: 0, 产品: 0, 技术: 0 } as Record<TopicCategory, number>;
    for (const row of res.rows) out[row.category] = row.n;
    return out;
  } finally {
    client.release();
  }
}

/** 按 id 读取单个专题 */
export async function getTopicById(id: number): Promise<TopicRow | null> {
  const pool = getReadPool();
  const client = await pool.connect();
  try {
    const res = await client.query<TopicRow>(
      `SELECT id::int AS id, name, category, keywords, description,
              created_at::text AS created_at, updated_at::text AS updated_at
       FROM topics
       WHERE id = $1::bigint`,
      [id]
    );
    return res.rows[0] ?? null;
  } finally {
    client.release();
  }
}

/**
 * 关键词出现频次：每个关键词命中多少篇日报（标题或正文任一命中即计 1，按专题关键词顺序返回）。
 * 无关键词时返回空数组。
 */
export async function getKeywordStats(keywords: string[]): Promise<TopicKeywordStat[]> {
  if (keywords.length === 0) return [];
  const pool = getReadPool();
  const client = await pool.connect();
  try {
    const res = await client.query<TopicKeywordStat>(
      `SELECT kw.k AS keyword, count(d.id)::int AS hits
       FROM unnest($1::text[]) WITH ORDINALITY AS kw(k, ord)
       LEFT JOIN daily_reports d
         ON (${K_TITLE_HIT} OR ${K_BODY_HIT})
       GROUP BY kw.k, kw.ord
       ORDER BY kw.ord`,
      [keywords]
    );
    return res.rows;
  } finally {
    client.release();
  }
}

/**
 * 相关日报：多关键词 AND（每个关键词都命中标题或正文），按日期倒序。
 * 每篇返回命中词拆分：标题命中 / 仅正文命中；report_markdown 仅供服务端生成摘要。
 */
export async function getRelatedReports(
  keywords: string[],
  limit: number = RELATED_REPORTS_LIMIT
): Promise<TopicRelated> {
  if (keywords.length === 0) return { total: 0, items: [] };
  const pool = getReadPool();
  const client = await pool.connect();
  try {
    const countRes = await client.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM daily_reports d WHERE ${AND_ALL_KEYWORDS}`,
      [keywords]
    );
    const total: number = countRes.rows[0].total;

    const res = await client.query<RelatedReport>(
      `SELECT d.id::int AS id, d.report_date::text, d.title, d.generated_at::text,
              d.total_articles, d.headline_count, d.status, d.report_markdown,
              (SELECT array_agg(k) FROM unnest($1::text[]) AS kw(k) WHERE ${K_TITLE_HIT}) AS title_hits,
              (SELECT array_agg(k) FROM unnest($1::text[]) AS kw(k) WHERE ${K_BODY_HIT}) AS body_hits
       FROM daily_reports d
       WHERE ${AND_ALL_KEYWORDS}
       ORDER BY d.report_date DESC, d.id DESC
       LIMIT $2`,
      [keywords, limit]
    );
    const items = res.rows.map((row) => ({
      ...row,
      title_hits: row.title_hits ?? [],
      body_hits: row.body_hits ?? [],
    }));
    return { total, items };
  } finally {
    client.release();
  }
}
