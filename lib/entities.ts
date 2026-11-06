// 实体数据访问层（读）—— ai_intel_reader 账号，仅 SELECT
//
// 契约：docs/phase3-stageB-interface.md 第 2 节与第 4 节
// - 读走 getReadPool()（只读账号），写走 lib/entities-write.ts；
// - 全部 SQL 参数化，动态 ORDER BY 只来自固定白名单；
// - 统计窗口默认以「今天」为右端点（含当天，不含第 8 天 / 第 31 天），
//   测试可显式传 asOf 固定基准日。
import { getReadPool } from "./db";
import { ENTITY_TYPES, type EntityType } from "./entities-extract";

/** 列表默认每页条数 */
export const DEFAULT_PAGE_SIZE = 20;
/** 每页上限（防止一次拉全量） */
export const MAX_PAGE_SIZE = 100;
/** 详情页提及条数上限 */
export const MENTION_LIMIT = 200;
/** 关联选题 / 商机条数上限 */
export const RELATED_LIMIT = 20;

export interface EntityListQuery {
  /** 搜索：匹配 name 或 aliases（ILIKE） */
  q?: string | null;
  /** 类型筛选（多选） */
  types?: string[] | null;
  /** 热度窗口：7 / 30，默认 7 */
  days?: number | null;
  page?: number;
  size?: number;
  /** 统计基准日（YYYY-MM-DD），默认今天（DISPLAY_TZ） */
  asOf?: string | null;
}

export interface EntityListItem {
  id: number;
  name: string;
  entityType: EntityType;
  mentionCount: number;
  recent7d: number;
  recent30d: number;
  firstMentionDate: string | null;
  lastMentionDate: string | null;
}

export interface EntityListResult {
  items: EntityListItem[];
  total: number;
  page: number;
  size: number;
}

export interface EntityRecord {
  id: number;
  name: string;
  normalizedName: string;
  entityType: EntityType;
  aliases: string[];
  description: string | null;
  website: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EntityStats {
  mentionCount: number;
  recent7d: number;
  recent30d: number;
  /** 出现过的不同日期数 */
  distinctMentionDays: number;
  firstMentionDate: string | null;
  lastMentionDate: string | null;
  /** mentionCount >= 3 且 distinctMentionDays >= 2 才为 true */
  dataSufficient: boolean;
}

export interface EntityMentionRow {
  id: number;
  mentionDate: string;
  sourceTitle: string | null;
  sourceUrl: string | null;
  context: string | null;
  importanceScore: number;
  /** 与 mentionDate 相同（日报日期软引用） */
  reportDate: string;
}

export interface RelatedIdeaRow {
  id: number;
  title: string;
  reportDate: string;
}

export interface RelatedOpportunityRow {
  id: number;
  title: string;
  sourceReportDate: string | null;
}

export interface EntityDetail {
  entity: EntityRecord;
  stats: EntityStats;
  mentions: EntityMentionRow[];
  relatedIdeas: RelatedIdeaRow[];
  relatedOpportunities: RelatedOpportunityRow[];
}

/* ==================== 工具 ==================== */

/** 展示时区的「今天」（YYYY-MM-DD），避免依赖数据库会话时区 */
export function todayInDisplayTz(): string {
  const tz = process.env.DISPLAY_TZ || "Asia/Shanghai";
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/** ILIKE 通配符转义（配合默认转义符 \） */
function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** 只保留合法类型，非法值忽略 */
export function normalizeTypes(types: string[] | null | undefined): EntityType[] {
  if (!types || types.length === 0) return [];
  const allowed = new Set<string>(ENTITY_TYPES);
  const out: EntityType[] = [];
  for (const t of types) {
    const v = t.trim().toLowerCase();
    if (!allowed.has(v)) continue;
    if (out.includes(v as EntityType)) continue;
    out.push(v as EntityType);
  }
  return out;
}

/** 热度窗口只接受 7 / 30，其余回落 7 */
export function normalizeDays(days: number | null | undefined): 7 | 30 {
  return days === 30 ? 30 : 7;
}

/** 分页参数收敛：page >= 1，1 <= size <= 100 */
export function normalizePaging(page?: number, size?: number): { page: number; size: number } {
  const p = Number.isFinite(page) ? Math.max(1, Math.trunc(page as number)) : 1;
  const rawSize = Number.isFinite(size) ? Math.trunc(size as number) : DEFAULT_PAGE_SIZE;
  const s = Math.min(MAX_PAGE_SIZE, Math.max(1, rawSize));
  return { page: p, size: s };
}

/** 契约 §4 硬性规则：提及 >= 3 次且覆盖 >= 2 天才构成趋势判断依据 */
export function isDataSufficient(mentionCount: number, distinctMentionDays: number): boolean {
  return mentionCount >= 3 && distinctMentionDays >= 2;
}

/* ==================== 列表 ==================== */

interface ListRow {
  id: number;
  name: string;
  entity_type: EntityType;
  mention_count: number;
  recent7d: number;
  recent30d: number;
  first_mention_date: string | null;
  last_mention_date: string | null;
}

/** 实体列表：搜索 / 类型多选 / 热度窗口 + 分页 */
export async function listEntities(q: EntityListQuery = {}): Promise<EntityListResult> {
  const { page, size } = normalizePaging(q.page, q.size);
  const days = normalizeDays(q.days);
  const asOf = q.asOf ?? todayInDisplayTz();
  const types = normalizeTypes(q.types);
  const keyword = q.q?.trim() ? `%${escapeLike(q.q.trim())}%` : null;
  const typeFilter = types.length > 0 ? types : null;
  const offset = (page - 1) * size;
  // ORDER BY 只允许取自固定白名单，杜绝列名注入
  const orderColumn = days === 30 ? "recent30d" : "recent7d";

  // 计数与列表互不依赖：分别从连接池取连接并发执行（同一 client 不支持并发查询）
  const pool = getReadPool();
  const [countRes, listRes] = await Promise.all([
    pool.query<{ total: number }>(
      `SELECT count(*)::int AS total
       FROM entities e
       WHERE ($1::text IS NULL
              OR e.name ILIKE $1
              OR EXISTS (SELECT 1 FROM unnest(e.aliases) AS a WHERE a ILIKE $1))
         AND ($2::text[] IS NULL OR e.entity_type = ANY($2::text[]))`,
      [keyword, typeFilter]
    ),
    pool.query<ListRow>(
      `SELECT e.id::int AS id,
              e.name,
              e.entity_type,
              count(m.id)::int AS mention_count,
              (count(m.id) FILTER (
                WHERE m.mention_date >= $1::date - 6 AND m.mention_date <= $1::date
              ))::int AS recent7d,
              (count(m.id) FILTER (
                WHERE m.mention_date >= $1::date - 29 AND m.mention_date <= $1::date
              ))::int AS recent30d,
              min(m.mention_date)::text AS first_mention_date,
              max(m.mention_date)::text AS last_mention_date
       FROM entities e
       LEFT JOIN entity_mentions m ON m.entity_id = e.id
       WHERE ($2::text IS NULL
              OR e.name ILIKE $2
              OR EXISTS (SELECT 1 FROM unnest(e.aliases) AS a WHERE a ILIKE $2))
         AND ($3::text[] IS NULL OR e.entity_type = ANY($3::text[]))
       GROUP BY e.id, e.name, e.entity_type
       ORDER BY ${orderColumn} DESC, mention_count DESC, last_mention_date DESC NULLS LAST, e.name ASC
       LIMIT $4 OFFSET $5`,
      [asOf, keyword, typeFilter, size, offset]
    ),
  ]);

  return {
    items: listRes.rows.map((row) => ({
      id: row.id,
      name: row.name,
      entityType: row.entity_type,
      mentionCount: row.mention_count,
      recent7d: row.recent7d,
      recent30d: row.recent30d,
      firstMentionDate: row.first_mention_date,
      lastMentionDate: row.last_mention_date,
    })),
    total: countRes.rows[0]?.total ?? 0,
    page,
    size,
  };
}

/* ==================== 详情 ==================== */

export interface EntityDetailOptions {
  /** 统计基准日，默认今天 */
  asOf?: string | null;
}

/** 实体详情：基础信息 + 统计 + 提及时间线 + 关联选题 / 商机 */
export async function getEntityDetail(
  id: number,
  options: EntityDetailOptions = {}
): Promise<EntityDetail | null> {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const asOf = options.asOf ?? todayInDisplayTz();
  const pool = getReadPool();

  const entityRes = await pool.query<{
    id: number;
    name: string;
    normalized_name: string;
    entity_type: EntityType;
    aliases: string[] | null;
    description: string | null;
    website: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT id::int AS id, name, normalized_name, entity_type, aliases,
            description, website, created_at::text AS created_at, updated_at::text AS updated_at
     FROM entities
     WHERE id = $1::int`,
    [id]
  );
  const row = entityRes.rows[0];
  if (!row) return null;

  // 四条查询互不依赖，各自从池中取连接并发执行
  const [statsRes, mentionsRes, ideasRes, oppsRes] = await Promise.all([
    pool.query<{
      mention_count: number;
      distinct_days: number;
      recent7d: number;
      recent30d: number;
      first_date: string | null;
      last_date: string | null;
    }>(
      `SELECT count(*)::int AS mention_count,
              count(DISTINCT mention_date)::int AS distinct_days,
              (count(*) FILTER (
                WHERE mention_date >= $2::date - 6 AND mention_date <= $2::date
              ))::int AS recent7d,
              (count(*) FILTER (
                WHERE mention_date >= $2::date - 29 AND mention_date <= $2::date
              ))::int AS recent30d,
              min(mention_date)::text AS first_date,
              max(mention_date)::text AS last_date
       FROM entity_mentions
       WHERE entity_id = $1::int`,
      [id, asOf]
    ),
    pool.query<{
      id: number;
      mention_date: string;
      source_title: string | null;
      source_url: string | null;
      context: string | null;
      importance_score: number;
    }>(
      `SELECT id::int AS id, mention_date::text AS mention_date,
              source_title, source_url, context, importance_score::int AS importance_score
       FROM entity_mentions
       WHERE entity_id = $1::int
       ORDER BY mention_date DESC, importance_score DESC, id ASC
       LIMIT $2::int`,
      [id, MENTION_LIMIT]
    ),
    // 关联选题：entity_mentions.mention_date = topic_ideas.report_date（契约 §2.4）
    pool.query<{ id: number; title: string; report_date: string }>(
      `SELECT DISTINCT t.id::int AS id, t.title, t.report_date::text AS report_date
       FROM topic_ideas t
       JOIN entity_mentions m ON m.mention_date = t.report_date
       WHERE m.entity_id = $1::int
       ORDER BY report_date DESC, id DESC
       LIMIT $2::int`,
      [id, RELATED_LIMIT]
    ),
    // 关联商机：把 topic_ideas 换成 opportunities、用 source_report_date
    pool.query<{ id: number; title: string; source_report_date: string | null }>(
      `SELECT DISTINCT o.id::int AS id, o.title, o.source_report_date::text AS source_report_date
       FROM opportunities o
       JOIN entity_mentions m ON m.mention_date = o.source_report_date
       WHERE m.entity_id = $1::int AND o.source_report_date IS NOT NULL
       ORDER BY source_report_date DESC, id DESC
       LIMIT $2::int`,
      [id, RELATED_LIMIT]
    ),
  ]);

  const s = statsRes.rows[0];
  const mentionCount = s?.mention_count ?? 0;
  const distinctDays = s?.distinct_days ?? 0;

  return {
    entity: {
      id: row.id,
      name: row.name,
      normalizedName: row.normalized_name,
      entityType: row.entity_type,
      aliases: row.aliases ?? [],
      description: row.description,
      website: row.website,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    stats: {
      mentionCount,
      recent7d: s?.recent7d ?? 0,
      recent30d: s?.recent30d ?? 0,
      distinctMentionDays: distinctDays,
      firstMentionDate: s?.first_date ?? null,
      lastMentionDate: s?.last_date ?? null,
      dataSufficient: isDataSufficient(mentionCount, distinctDays),
    },
    mentions: mentionsRes.rows.map((m) => ({
      id: m.id,
      mentionDate: m.mention_date,
      sourceTitle: m.source_title,
      sourceUrl: m.source_url,
      context: m.context,
      importanceScore: m.importance_score,
      reportDate: m.mention_date,
    })),
    relatedIdeas: ideasRes.rows.map((r) => ({
      id: r.id,
      title: r.title,
      reportDate: r.report_date,
    })),
    relatedOpportunities: oppsRes.rows.map((r) => ({
      id: r.id,
      title: r.title,
      sourceReportDate: r.source_report_date,
    })),
  };
}
