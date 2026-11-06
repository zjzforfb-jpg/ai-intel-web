// 选题提取 —— 服务端数据访问（topic_ideas 表 CRUD）
//
// 阶段 2 改造（契约 docs/phase2-stageB-interface.md 第 3.6 节）：
// - 新增跨日报语义查重（findDuplicateIdeas / createIdeaDeduplicated）；
// - 同主题但切入角度（angle）显著不同的选题允许共存，但必须标注差异，不静默丢弃。
//
// 红线：
// - 读走 getReadPool()（ai_intel_reader，仅 SELECT），写走 getWritePool()（ai_intel_writer）；
// - 全部 SQL 参数化，动态列名仅来自固定白名单；严禁 DDL。
import { getReadPool } from "./db";
import { getWritePool } from "./db-write";
import type { IdeaRow, IdeaStatus, IdeaWriteValues } from "./ideas-shared";
import { isIdeaStatus } from "./ideas-shared";
import { isDuplicate, type DedupResult } from "./dedup";

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

/* ==================== 跨日报语义查重（阶段 2） ==================== */

/** 角度差异阈值：两段角度文本的归一化后重合度低于此值，视为「切入角度显著不同」 */
const ANGLE_DIVERGENCE_THRESHOLD = 0.6;

/**
 * 判断两条选题的切入角度是否「显著不同」。
 * 采用归一化后的字符级 Jaccard：重合度低于阈值即认为角度不同。
 */
export function isAngleDifferent(angleA: string | null, angleB: string | null): boolean {
  const a = (angleA ?? "").replace(/\s+/g, "");
  const b = (angleB ?? "").replace(/\s+/g, "");
  if (!a || !b) return false;
  const setA = new Set(a.split(""));
  const setB = new Set(b.split(""));
  let inter = 0;
  for (const ch of setA) if (setB.has(ch)) inter += 1;
  const union = setA.size + setB.size - inter;
  if (union === 0) return false;
  return inter / union < ANGLE_DIVERGENCE_THRESHOLD;
}

/** 查重用到的历史选题（只取判定所需字段） */
interface IdeaCandidate {
  id: number;
  title: string;
  angle: string | null;
}

/**
 * 跨日报语义查重：返回与给定选题重复的历史选题。
 * 全表比对（不限日期），已放弃（status='已放弃'）的记录不参与判定。
 *
 * @param title 待查重标题
 * @param angle 待查重切入角度（用于判断是否只是「同主题不同角度」）
 * @param excludeId 排除自身 id（更新场景）
 */
export async function findDuplicateIdeas(
  title: string,
  angle?: string | null,
  excludeId?: number
): Promise<IdeaRow[]> {
  const client = await getReadPool().connect();
  try {
    const res = await client.query<IdeaRow>(
      `SELECT ${IDEA_COLUMNS}
       FROM topic_ideas
       WHERE ($1::int IS NULL OR id <> $1::int)
         AND status <> '已放弃'
       ORDER BY id ASC`,
      [excludeId ?? null]
    );
    return res.rows;
  } finally {
    client.release();
  }
}

/**
 * 语义去重后创建选题。
 * - 无重复 → 正常创建，返回 created；
 * - 有重复且角度显著不同 → 仍然创建，但 reason 标注「同主题不同角度，已并存」；
 * - 有重复且角度相同/缺失 → 不创建，返回重复列表与原因。
 */
export async function createIdeaDeduplicated(
  value: IdeaWriteValues
): Promise<{ created: IdeaRow | null; duplicates: IdeaRow[]; reason?: string }> {
  const rows = await findDuplicateIdeas(value.title, value.angle);
  const candidates: IdeaCandidate[] = rows.map((r) => ({ id: r.id, title: r.title, angle: r.angle }));

  const result: DedupResult = isDuplicate(
    { title: value.title, description: value.angle },
    candidates
  );

  if (!result.duplicate) {
    const created = await createIdea(value);
    return { created, duplicates: [] };
  }

  // 找到被命中的历史记录
  const matchedRow = rows.find((r) => r.title === result.match?.title) ?? rows[0];
  const duplicates = matchedRow ? [matchedRow] : [];

  // 同主题但角度显著不同 → 允许并存，但必须标注差异（不静默丢弃）
  if (matchedRow && isAngleDifferent(matchedRow.angle, value.angle)) {
    const created = await createIdea(value);
    return {
      created,
      duplicates,
      reason: `与已有选题「${matchedRow.title}」同主题但切入角度不同，已并存保留`,
    };
  }

  return {
    created: null,
    duplicates,
    reason: `语义重复：${result.match?.reason ?? result.explanation}`,
  };
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
