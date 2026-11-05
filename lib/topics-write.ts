// 专题追踪 —— 写查询（ai_intel_writer，仅 topics 表 CRUD）
// 红线：全部 SQL 参数化；不执行 DDL；不写 daily_reports；只动 topics。
import { getWritePool } from "./db-write";
import type { TopicRow } from "./db-write";
import type { TopicInput } from "./topics-input";

const TOPIC_RETURNING = `id::int AS id, name, category, keywords, description,
       created_at::text AS created_at, updated_at::text AS updated_at`;

export type WriteResult =
  | { ok: true; topic: TopicRow }
  | { ok: false; code: "conflict" | "not_found" | "db_error"; message: string };

/** pg 唯一约束冲突（topics.name UNIQUE） */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "23505"
  );
}

function toDbError(error: unknown): WriteResult {
  return {
    ok: false,
    code: "db_error",
    message: error instanceof Error ? error.message : "数据库写入失败（未知错误）",
  };
}

/** 创建专题 */
export async function createTopic(input: TopicInput): Promise<WriteResult> {
  const pool = getWritePool();
  const client = await pool.connect();
  try {
    const res = await client.query<TopicRow>(
      `INSERT INTO topics (name, category, keywords, description)
       VALUES ($1, $2, $3::text[], $4)
       RETURNING ${TOPIC_RETURNING}`,
      [input.name, input.category, input.keywords, input.description]
    );
    return { ok: true, topic: res.rows[0] };
  } catch (error) {
    if (isUniqueViolation(error))
      return { ok: false, code: "conflict", message: "专题名称已存在，请换一个名称" };
    return toDbError(error);
  } finally {
    client.release();
  }
}

/** 更新专题（整体覆盖 name/category/keywords/description） */
export async function updateTopic(id: number, input: TopicInput): Promise<WriteResult> {
  const pool = getWritePool();
  const client = await pool.connect();
  try {
    const res = await client.query<TopicRow>(
      `UPDATE topics
       SET name = $2, category = $3, keywords = $4::text[], description = $5,
           updated_at = NOW()
       WHERE id = $1::bigint
       RETURNING ${TOPIC_RETURNING}`,
      [id, input.name, input.category, input.keywords, input.description]
    );
    if (res.rows.length === 0)
      return { ok: false, code: "not_found", message: "专题不存在或已被删除" };
    return { ok: true, topic: res.rows[0] };
  } catch (error) {
    if (isUniqueViolation(error))
      return { ok: false, code: "conflict", message: "专题名称已存在，请换一个名称" };
    return toDbError(error);
  } finally {
    client.release();
  }
}

/** 删除专题 */
export async function deleteTopic(id: number): Promise<WriteResult> {
  const pool = getWritePool();
  const client = await pool.connect();
  try {
    const res = await client.query<TopicRow>(
      `DELETE FROM topics WHERE id = $1::bigint RETURNING ${TOPIC_RETURNING}`,
      [id]
    );
    if (res.rows.length === 0)
      return { ok: false, code: "not_found", message: "专题不存在或已被删除" };
    return { ok: true, topic: res.rows[0] };
  } catch (error) {
    return toDbError(error);
  } finally {
    client.release();
  }
}
