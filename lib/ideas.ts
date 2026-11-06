// 选题提取 —— 服务端数据访问（topic_ideas 表 CRUD）
// 红线：
// - 读走 getReadPool()（ai_intel_reader，仅 SELECT），写走 getWritePool()（ai_intel_writer）；
// - 全部 SQL 参数化，动态列名仅来自固定白名单；严禁 DDL。
import { getReadPool } from "./db";
import { getWritePool } from "./db-write";
import type { IdeaRow, IdeaStatus, IdeaWriteValues } from "./ideas-shared";
import { isIdeaStatus } from "./ideas-shared";

export type { IdeaRow, IdeaStatus };

/** 同日同标题 UNIQUE 冲突（pg 错误码 23505）时抛出，供 API 层映射为 409 */
export class IdeaConflictError extends Error {
  constructor(message = "该日期下已存在相同标题的选题") {
    super(message);
    this.name = "IdeaConflictError";
  }
}

// id 是 BIGSERIAL，pg 默认把 bigint 解析成字符串，这里显式转 int 以匹配 IdeaRow.id: number
const IDEA_COLUMNS = `id::int AS id, report_date::text AS report_date, title, angle,
  source_material, reference_visuals, value_score::int AS value_score, status,
  created_at::text AS created_at, updated_at::text AS updated_at`;

/** 字段 → 列名白名单（update 动态 SET 只能取自这里，杜绝列名注入） */
const FIELD_COLUMN: Record<keyof IdeaWriteValues, string> = {
  report_date: "report_date",
  title: "title",
  angle: "angle",
  source_material: "source_material",
  reference_visuals: "reference_visuals",
  value_score: "value_score",
  status: "status",
};

export interface IdeaListQuery {
  date?: string | null;
  status?: IdeaStatus | null;
}

/** 列表查询：按日期 + 状态筛选，同日内评分高在前、后按 id 稳定排序 */
export async function listIdeas(q: IdeaListQuery = {}): Promise<IdeaRow[]> {
  const date = q.date ?? null;
  const status = q.status ?? null;

  const client = await getReadPool().connect();
  try {
    const res = await client.query<IdeaRow>(
      `SELECT ${IDEA_COLUMNS}
       FROM topic_ideas
       WHERE ($1::date IS NULL OR report_date = $1::date)
         AND ($2::text IS NULL OR status = $2)
       ORDER BY report_date DESC, value_score DESC NULLS LAST, id ASC
       LIMIT 1000`,
      [date, status]
    );
    return res.rows;
  } finally {
    client.release();
  }
}

/** 选题总数（页头统计用，不受筛选影响） */
export async function countIdeas(): Promise<number> {
  const client = await getReadPool().connect();
  try {
    const res = await client.query("SELECT count(*)::int AS total FROM topic_ideas");
    return res.rows[0].total as number;
  } finally {
    client.release();
  }
}

export async function getIdea(id: number): Promise<IdeaRow | null> {
  const client = await getReadPool().connect();
  try {
    const res = await client.query<IdeaRow>(
      `SELECT ${IDEA_COLUMNS} FROM topic_ideas WHERE id = $1::int`,
      [id]
    );
    return res.rows[0] ?? null;
  } finally {
    client.release();
  }
}

export async function createIdea(value: IdeaWriteValues): Promise<IdeaRow> {
  const client = await getWritePool().connect();
  try {
    const res = await client.query<IdeaRow>(
      `INSERT INTO topic_ideas
         (report_date, title, angle, source_material, reference_visuals, value_score, status)
       VALUES ($1::date, $2, $3, $4, $5, $6, $7)
       RETURNING ${IDEA_COLUMNS}`,
      [
        value.report_date,
        value.title,
        value.angle,
        value.source_material,
        value.reference_visuals,
        value.value_score,
        value.status,
      ]
    );
    return res.rows[0];
  } catch (err) {
    // UNIQUE (report_date, title) 冲突 → 语义化错误，供上层映射 409
    if (isUniqueViolation(err)) throw new IdeaConflictError();
    throw err;
  } finally {
    client.release();
  }
}

/** 局部更新：只写 patch 中出现的字段，updated_at 统一刷新；不存在返回 null */
export async function updateIdea(
  id: number,
  patch: Partial<IdeaWriteValues>
): Promise<IdeaRow | null> {
  const fields = (Object.keys(patch) as (keyof IdeaWriteValues)[]).filter(
    (f) => f in FIELD_COLUMN
  );
  const client = await getWritePool().connect();
  try {
    if (fields.length === 0) {
      const res = await client.query<IdeaRow>(
        `SELECT ${IDEA_COLUMNS} FROM topic_ideas WHERE id = $1::int`,
        [id]
      );
      return res.rows[0] ?? null;
    }

    const values: unknown[] = [];
    const sets = fields.map((f) => {
      values.push(patch[f]);
      // 仅日期列需要显式转型，其余按列类型推断
      const cast = f === "report_date" ? "::date" : "";
      return `${FIELD_COLUMN[f]} = $${values.length}${cast}`;
    });
    values.push(id);

    const res = await client.query<IdeaRow>(
      `UPDATE topic_ideas
       SET ${sets.join(", ")}, updated_at = NOW()
       WHERE id = $${values.length}::int
       RETURNING ${IDEA_COLUMNS}`,
      values
    );
    return res.rows[0] ?? null;
  } finally {
    client.release();
  }
}

export async function deleteIdea(id: number): Promise<boolean> {
  const client = await getWritePool().connect();
  try {
    const res = await client.query("DELETE FROM topic_ideas WHERE id = $1::int", [id]);
    return (res.rowCount ?? 0) > 0;
  } finally {
    client.release();
  }
}

/* ==================== 内部工具 ==================== */

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "23505"
  );
}
