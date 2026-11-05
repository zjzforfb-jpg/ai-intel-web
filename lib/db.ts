// 数据库连接与查询 —— 只读用户，仅 SELECT
import { Pool } from "pg";

let pool: Pool | null = null;

function getPool(): Pool {
  if (pool) return pool;

  const host = process.env.DB_HOST || "postgres";
  const port = Number(process.env.DB_PORT) || 5432;
  const user = process.env.DB_USER || "ai_intel_reader";
  const password = process.env.DB_PASSWORD;
  const database = process.env.DB_NAME || "ai_intelligence";

  if (!password) {
    throw new Error("DB_PASSWORD is not set in environment");
  }

  pool = new Pool({
    host,
    port,
    user,
    password,
    database,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    // 只读用户，不需要 SSL
    ssl: false,
  });

  return pool;
}

export interface ReportRow {
  id: number;
  report_date: string;
  title: string;
  report_markdown: string | null;
  report_html: string | null;
  generated_at: string | null;
  total_articles: number | null;
  headline_count: number | null;
  status: string | null;
  validation: Record<string, unknown> | null;
  created_at: string;
}

export interface ReportListItem {
  id: number;
  report_date: string;
  title: string;
  generated_at: string | null;
  total_articles: number | null;
  headline_count: number | null;
  status: string | null;
}

export async function getLatestReport(): Promise<ReportRow | null> {
  const client = await getPool().connect();
  try {
    const res = await client.query<ReportRow>(
      `SELECT id, report_date::text, title, report_markdown, report_html,
              generated_at::text, total_articles, headline_count, status,
              validation, created_at::text
       FROM daily_reports
       ORDER BY report_date DESC
       LIMIT 1`
    );
    return res.rows[0] ?? null;
  } finally {
    client.release();
  }
}

export async function getReportByDate(date: string): Promise<ReportRow | null> {
  const client = await getPool().connect();
  try {
    const res = await client.query<ReportRow>(
      `SELECT id, report_date::text, title, report_markdown, report_html,
              generated_at::text, total_articles, headline_count, status,
              validation, created_at::text
       FROM daily_reports
       WHERE report_date = $1::date`,
      [date]
    );
    return res.rows[0] ?? null;
  } finally {
    client.release();
  }
}

export interface AdjacentReport {
  report_date: string;
  title: string;
}

export interface AdjacentReports {
  /** 日期更早的一篇（上一篇） */
  prev: AdjacentReport | null;
  /** 日期更新的一篇（下一篇） */
  next: AdjacentReport | null;
}

/**
 * 查询指定日期前后的真实相邻日报
 * 只返回数据库里确实存在的记录，不构造任何虚构日期
 */
export async function getAdjacentReports(date: string): Promise<AdjacentReports> {
  const client = await getPool().connect();
  try {
    const [prevRes, nextRes] = await Promise.all([
      client.query<AdjacentReport>(
        `SELECT report_date::text, title
         FROM daily_reports
         WHERE report_date < $1::date
         ORDER BY report_date DESC
         LIMIT 1`,
        [date]
      ),
      client.query<AdjacentReport>(
        `SELECT report_date::text, title
         FROM daily_reports
         WHERE report_date > $1::date
         ORDER BY report_date ASC
         LIMIT 1`,
        [date]
      ),
    ]);
    return {
      prev: prevRes.rows[0] ?? null,
      next: nextRes.rows[0] ?? null,
    };
  } finally {
    client.release();
  }
}

export async function listReports(
  page = 1,
  size = 20
): Promise<{ items: ReportListItem[]; total: number }> {
  const client = await getPool().connect();
  try {
    const offset = (page - 1) * size;
    const countRes = await client.query("SELECT count(*)::int AS total FROM daily_reports");
    const total = countRes.rows[0].total;
    const res = await client.query<ReportListItem>(
      `SELECT id, report_date::text, title, generated_at::text,
              total_articles, headline_count, status
       FROM daily_reports
       ORDER BY report_date DESC
       LIMIT $1 OFFSET $2`,
      [size, offset]
    );
    return { items: res.rows, total };
  } finally {
    client.release();
  }
}

export async function searchReports(
  q: string,
  page = 1,
  size = 20
): Promise<{ items: ReportListItem[]; total: number }> {
  const client = await getPool().connect();
  try {
    const pattern = `%${q}%`;
    const offset = (page - 1) * size;
    const countRes = await client.query(
      `SELECT count(*)::int AS total FROM daily_reports
       WHERE title ILIKE $1 OR report_markdown ILIKE $1`,
      [pattern]
    );
    const total = countRes.rows[0].total;
    const res = await client.query<ReportListItem>(
      `SELECT id, report_date::text, title, generated_at::text,
              total_articles, headline_count, status
       FROM daily_reports
       WHERE title ILIKE $1 OR report_markdown ILIKE $1
       ORDER BY report_date DESC
       LIMIT $2 OFFSET $3`,
      [pattern, size, offset]
    );
    return { items: res.rows, total };
  } finally {
    client.release();
  }
}

export async function getStats(): Promise<{
  total_reports: number;
  latest_date: string | null;
  latest_generated_at: string | null;
  earliest_date: string | null;
  total_articles_all: number;
}> {
  const client = await getPool().connect();
  try {
    const res = await client.query(
      `SELECT count(*)::int AS total_reports,
              max(report_date)::text AS latest_date,
              max(generated_at)::text AS latest_generated_at,
              min(report_date)::text AS earliest_date,
              coalesce(sum(total_articles), 0)::int AS total_articles_all
       FROM daily_reports`
    );
    return res.rows[0];
  } finally {
    client.release();
  }
}

/* ==================== 历史档案馆 / 全文搜索 ==================== */

/** 每页最大返回条数（防止一次拉全量） */
export const ARCHIVE_PAGE_SIZE = 10;

export interface ArchiveQuery {
  /** 已拆分的关键词（AND 语义：每个词都必须命中标题或正文） */
  keywords: string[];
  dateFrom?: string | null;
  dateTo?: string | null;
  year?: number | null;
  month?: number | null;
  page: number;
  size?: number;
}

export interface ArchiveHit extends ReportListItem {
  /** 用于生成匹配摘要，仅服务端使用 */
  report_markdown: string | null;
  /** 相关度得分（标题命中权重 10 / 正文命中权重 3） */
  score: number;
}

export interface ArchiveFacets {
  total: number;
  earliest_date: string | null;
  latest_date: string | null;
  /** 数据中真实存在的年份（倒序） */
  years: number[];
  /** 每个年份下真实存在的月份（倒序） */
  monthsByYear: Record<number, number[]>;
}

/**
 * 搜索历史日报（全文关键词 + 日期/年月筛选 + 相关度排序 + 分页）
 * 安全性：
 * - 全部参数化 SQL，关键词以 text[] 绑定，禁止拼接用户输入
 * - ILIKE 通配符（% _ \）在 SQL 内转义，按字面匹配
 * - 只读查询，仅 SELECT
 */
export async function searchArchive(
  q: ArchiveQuery
): Promise<{ items: ArchiveHit[]; total: number }> {
  const size = q.size ?? ARCHIVE_PAGE_SIZE;
  const page = Math.max(1, q.page);
  const offset = (page - 1) * size;
  const hasKw = q.keywords.length > 0;

  const client = await getPool().connect();
  try {
    // WHERE 片段对 count 与 list 复用同一参数位：
    // $1 keywords(text[]), $2 from, $3 to, $4 year, $5 month
    const where = `
      WHERE ($2::date IS NULL OR report_date >= $2)
        AND ($3::date IS NULL OR report_date <= $3)
        AND ($4::int IS NULL OR EXTRACT(YEAR FROM report_date)::int = $4)
        AND ($5::int IS NULL OR EXTRACT(MONTH FROM report_date)::int = $5)
        AND (cardinality($1::text[]) = 0 OR NOT EXISTS (
              SELECT 1 FROM unnest($1::text[]) AS kw(k)
              WHERE NOT (
                title ILIKE '%' || replace(replace(replace(k, E'\\\\', E'\\\\\\\\'), '%', E'\\\\%'), '_', E'\\\\_') || '%'
                OR report_markdown ILIKE '%' || replace(replace(replace(k, E'\\\\', E'\\\\\\\\'), '%', E'\\\\%'), '_', E'\\\\_') || '%'
              )
            ))`;

    const countRes = await client.query(
      `SELECT count(*)::int AS total FROM daily_reports ${where}`,
      [q.keywords, q.dateFrom ?? null, q.dateTo ?? null, q.year ?? null, q.month ?? null]
    );
    const total: number = countRes.rows[0].total;

    // 相关度：每个关键词 标题命中 +10 / 正文命中 +3；无关键词时按日期倒序
    const scoreExpr = `
      (SELECT count(*) FROM unnest($1::text[]) AS kw(k)
        WHERE title ILIKE '%' || replace(replace(replace(k, E'\\\\', E'\\\\\\\\'), '%', E'\\\\%'), '_', E'\\\\_') || '%') * 10
      + (SELECT count(*) FROM unnest($1::text[]) AS kw(k)
        WHERE report_markdown ILIKE '%' || replace(replace(replace(k, E'\\\\', E'\\\\\\\\'), '%', E'\\\\%'), '_', E'\\\\_') || '%') * 3`;

    const orderBy = hasKw
      ? "ORDER BY score DESC, report_date DESC"
      : "ORDER BY report_date DESC";

    const res = await client.query<ArchiveHit>(
      `SELECT id, report_date::text, title, generated_at::text,
              total_articles, headline_count, status, report_markdown,
              ${scoreExpr} AS score
       FROM daily_reports
       ${where}
       ${orderBy}
       LIMIT $6 OFFSET $7`,
      [q.keywords, q.dateFrom ?? null, q.dateTo ?? null, q.year ?? null, q.month ?? null, size, offset]
    );
    return { items: res.rows, total };
  } finally {
    client.release();
  }
}

/**
 * 档案馆统计与筛选器数据（全部来自真实数据，不构造任何年月）
 */
export async function getArchiveFacets(): Promise<ArchiveFacets> {
  const client = await getPool().connect();
  try {
    const [statsRes, facetRes] = await Promise.all([
      client.query(
        `SELECT count(*)::int AS total,
                min(report_date)::text AS earliest_date,
                max(report_date)::text AS latest_date
         FROM daily_reports`
      ),
      client.query(
        `SELECT EXTRACT(YEAR FROM report_date)::int AS y,
                EXTRACT(MONTH FROM report_date)::int AS m
         FROM daily_reports
         GROUP BY 1, 2
         ORDER BY 1 DESC, 2 DESC`
      ),
    ]);
    const years: number[] = [];
    const monthsByYear: Record<number, number[]> = {};
    for (const row of facetRes.rows as Array<{ y: number; m: number }>) {
      if (!monthsByYear[row.y]) {
        monthsByYear[row.y] = [];
        years.push(row.y);
      }
      monthsByYear[row.y].push(row.m);
    }
    return {
      total: statsRes.rows[0].total,
      earliest_date: statsRes.rows[0].earliest_date,
      latest_date: statsRes.rows[0].latest_date,
      years,
      monthsByYear,
    };
  } finally {
    client.release();
  }
}
