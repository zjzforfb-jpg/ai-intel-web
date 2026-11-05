// 商业机会管理 —— 服务端数据访问（opportunities 表 CRUD + 来源日报软引用查询）
// 红线：
// - opportunities 读写走 getWritePool()（ai_intel_writer，仅 topics/opportunities CRUD）；
// - daily_reports 只读查询走 getReadPool()，绝不写入；
// - 全部 SQL 参数化，动态列名仅来自固定白名单；严禁 DDL。
import { getWritePool } from "./db-write";
import { getReadPool } from "./db";
import type { OpportunityRow, OpportunityStatus } from "./db-write";
import type { OpportunityWriteValues } from "./opportunities-shared";
import { OPPORTUNITY_PAGE_SIZE, isOpportunityStatus } from "./opportunities-shared";

export type { OpportunityRow, OpportunityStatus };

// id 是 BIGSERIAL，pg 默认把 bigint 解析成字符串，这里显式转 int 以匹配 OpportunityRow.id: number
const OPPORTUNITY_COLUMNS = `id::int AS id, title, description, category,
  source_report_date::text AS source_report_date, status, notes, action_plan,
  created_at::text AS created_at, updated_at::text AS updated_at`;

/** 字段 → 列名白名单（update 动态 SET 只能取自这里，杜绝列名注入） */
const FIELD_COLUMN: Record<keyof OpportunityWriteValues, string> = {
  title: "title",
  description: "description",
  category: "category",
  source_report_date: "source_report_date",
  status: "status",
  notes: "notes",
  action_plan: "action_plan",
};

export interface OpportunityListQuery {
  status?: OpportunityStatus | null;
  category?: string | null;
  page?: number;
  size?: number;
}

export interface OpportunityListResult {
  items: OpportunityRow[];
  total: number;
  page: number;
  size: number;
  totalPages: number;
}

export interface OpportunityFacets {
  /** 全部机会数（不受筛选影响） */
  total: number;
  /** 各状态数量（受 category 筛选影响），四种状态齐全 */
  statusCounts: Record<OpportunityStatus, number>;
  /** 真实存在的分类及数量（受 status 筛选影响），按数量倒序 */
  categories: Array<{ category: string; count: number }>;
}

/** 列表查询：状态 + 分类筛选 + 分页，按更新时间倒序 */
export async function listOpportunities(q: OpportunityListQuery): Promise<OpportunityListResult> {
  const size = Math.min(Math.max(q.size ?? OPPORTUNITY_PAGE_SIZE, 1), 100);
  const page = Math.max(q.page ?? 1, 1);
  const offset = (page - 1) * size;
  const status = q.status ?? null;
  const category = q.category ?? null;

  const client = await getWritePool().connect();
  try {
    const where = `WHERE ($1::text IS NULL OR status = $1)
        AND ($2::text IS NULL OR category = $2)`;
    const countRes = await client.query(
      `SELECT count(*)::int AS total FROM opportunities ${where}`,
      [status, category]
    );
    const total: number = countRes.rows[0].total;

    const res = await client.query<OpportunityRow>(
      `SELECT ${OPPORTUNITY_COLUMNS}
       FROM opportunities
       ${where}
       ORDER BY updated_at DESC, id DESC
       LIMIT $3 OFFSET $4`,
      [status, category, size, offset]
    );
    return {
      items: res.rows,
      total,
      page,
      size,
      totalPages: Math.max(1, Math.ceil(total / size)),
    };
  } finally {
    client.release();
  }
}

/** 筛选器数据：状态计数（按当前分类收窄）与分类计数（按当前状态收窄） */
export async function getOpportunityFacets(filter: {
  status?: OpportunityStatus | null;
  category?: string | null;
}): Promise<OpportunityFacets> {
  const status = filter.status ?? null;
  const category = filter.category ?? null;

  const client = await getWritePool().connect();
  try {
    const [totalRes, statusRes, categoryRes] = await Promise.all([
      client.query("SELECT count(*)::int AS total FROM opportunities"),
      client.query(
        `SELECT status, count(*)::int AS count
         FROM opportunities
         WHERE ($1::text IS NULL OR category = $1)
         GROUP BY status`,
        [category]
      ),
      client.query(
        `SELECT category, count(*)::int AS count
         FROM opportunities
         WHERE ($1::text IS NULL OR status = $1)
           AND category IS NOT NULL AND btrim(category) <> ''
         GROUP BY category
         ORDER BY count DESC, category ASC`,
        [status]
      ),
    ]);

    const statusCounts: Record<OpportunityStatus, number> = {
      待研究: 0,
      验证中: 0,
      已实施: 0,
      已放弃: 0,
    };
    for (const row of statusRes.rows as Array<{ status: string; count: number }>) {
      if (isOpportunityStatus(row.status)) {
        statusCounts[row.status] = row.count;
      }
    }

    return {
      total: totalRes.rows[0].total,
      statusCounts,
      categories: categoryRes.rows as Array<{ category: string; count: number }>,
    };
  } finally {
    client.release();
  }
}

export async function getOpportunity(id: number): Promise<OpportunityRow | null> {
  const client = await getWritePool().connect();
  try {
    const res = await client.query<OpportunityRow>(
      `SELECT ${OPPORTUNITY_COLUMNS} FROM opportunities WHERE id = $1::int`,
      [id]
    );
    return res.rows[0] ?? null;
  } finally {
    client.release();
  }
}

export async function createOpportunity(value: OpportunityWriteValues): Promise<OpportunityRow> {
  const client = await getWritePool().connect();
  try {
    const res = await client.query<OpportunityRow>(
      `INSERT INTO opportunities
         (title, description, category, source_report_date, status, notes, action_plan)
       VALUES ($1, $2, $3, $4::date, $5, $6, $7)
       RETURNING ${OPPORTUNITY_COLUMNS}`,
      [
        value.title,
        value.description,
        value.category,
        value.source_report_date,
        value.status,
        value.notes,
        value.action_plan,
      ]
    );
    return res.rows[0];
  } finally {
    client.release();
  }
}

/** 局部更新：只写 patch 中出现的字段，updated_at 统一刷新；不存在返回 null */
export async function updateOpportunity(
  id: number,
  patch: Partial<OpportunityWriteValues>
): Promise<OpportunityRow | null> {
  const fields = (Object.keys(patch) as (keyof OpportunityWriteValues)[]).filter(
    (f) => f in FIELD_COLUMN
  );
  const client = await getWritePool().connect();
  try {
    if (fields.length === 0) {
      const res = await client.query<OpportunityRow>(
        `SELECT ${OPPORTUNITY_COLUMNS} FROM opportunities WHERE id = $1::int`,
        [id]
      );
      return res.rows[0] ?? null;
    }

    const values: unknown[] = [];
    const sets = fields.map((f) => {
      values.push(patch[f]);
      // 仅日期列需要显式转型，其余按列类型推断
      const cast = f === "source_report_date" ? "::date" : "";
      return `${FIELD_COLUMN[f]} = $${values.length}${cast}`;
    });
    values.push(id);

    const res = await client.query<OpportunityRow>(
      `UPDATE opportunities
       SET ${sets.join(", ")}, updated_at = NOW()
       WHERE id = $${values.length}::int
       RETURNING ${OPPORTUNITY_COLUMNS}`,
      values
    );
    return res.rows[0] ?? null;
  } finally {
    client.release();
  }
}

export async function deleteOpportunity(id: number): Promise<boolean> {
  const client = await getWritePool().connect();
  try {
    const res = await client.query("DELETE FROM opportunities WHERE id = $1::int", [id]);
    return (res.rowCount ?? 0) > 0;
  } finally {
    client.release();
  }
}

/* ==================== 来源日报（软引用，只读） ==================== */

export interface SourceReportBrief {
  report_date: string;
  title: string;
}

/**
 * 按 source_report_date 查对应日报标题（只读账号）。
 * 软引用：日报可能已被清理或查询失败，调用方需优雅降级。
 */
export async function getSourceReportBrief(date: string): Promise<SourceReportBrief | null> {
  const client = await getReadPool().connect();
  try {
    const res = await client.query<SourceReportBrief>(
      `SELECT report_date::text, title FROM daily_reports WHERE report_date = $1::date`,
      [date]
    );
    return res.rows[0] ?? null;
  } finally {
    client.release();
  }
}
