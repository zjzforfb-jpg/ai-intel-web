// 内容生产 —— 写层（content_projects 写入）
//
// 红线：
// - 写走 getWritePool()（ai_intel_writer），读来源选题同样在写连接内完成，避免主从延迟；
// - 全部 SQL 参数化；可写列只来自下方白名单常量；
// - **绝不修改 topic_ideas 任何字段**（只 SELECT）；
// - 不执行 DDL。
//
// 依据：docs/phase3-stageB-interface.md §5

import { getWritePool } from "./db-write";
import type {
  ContentProjectRow,
  ContentType,
  ProductionStatus,
  ProjectPatchValues,
  ProjectStatus,
} from "./content-projects-shared";
import { projectStatusForImport } from "./content-projects-shared";
import type { ImportValues } from "./content-projects-shared";
import { resolveImportStatus } from "./content-import";
import { SUGGESTED_EXPORT_PATH } from "./content-export";

const DETAIL_COLUMNS = `id::int AS id, title, source_idea_id::int AS source_idea_id,
  source_report_date::text AS source_report_date, content_type, target_audience, status,
  content_angle, hook, key_points, reference_materials, production_notes,
  duration_seconds, video_form, open_questions, production_status,
  exported_at::text AS exported_at, export_path, script_result, storyboard_result,
  quality_check, created_at::text AS created_at, updated_at::text AS updated_at`;

/** 允许动态 SET 的列（白名单，杜绝列名注入） */
const PATCH_COLUMN: Record<keyof ProjectPatchValues, string> = {
  title: "title",
  content_type: "content_type",
  target_audience: "target_audience",
  content_angle: "content_angle",
  hook: "hook",
  key_points: "key_points",
  reference_materials: "reference_materials",
  production_notes: "production_notes",
  duration_seconds: "duration_seconds",
  video_form: "video_form",
  open_questions: "open_questions",
  status: "status",
};

/** JSONB 列需要序列化后绑定 */
const JSONB_FIELDS = new Set<keyof ProjectPatchValues>([
  "key_points",
  "reference_materials",
  "open_questions",
]);

/** 选题不存在（API 层映射 404） */
export class TopicIdeaNotFoundError extends Error {
  constructor(public readonly topicIdeaId: number) {
    super("选题不存在或已删除");
    this.name = "TopicIdeaNotFoundError";
  }
}

export interface CreateContentProjectInput {
  topicIdeaId: number;
  contentType: ContentType;
  targetAudience: string | null;
}

export interface CreateContentProjectResult {
  /** false 表示该选题已有内容项目，直接返回既有行（幂等） */
  created: boolean;
  row: ContentProjectRow;
}

/**
 * 从选题创建内容项目（幂等）。
 * - 选题不存在 → 抛 TopicIdeaNotFoundError；
 * - 已有同 source_idea_id 项目 → created=false，返回既有行；
 * - 否则插入新行，标题默认取选题标题，来源日报日期冗余自选题。
 */
export async function createContentProject(
  input: CreateContentProjectInput
): Promise<CreateContentProjectResult> {
  const client = await getWritePool().connect();
  try {
    const ideaRes = await client.query<{ id: number; title: string; report_date: string }>(
      `SELECT id::int AS id, title, report_date::text AS report_date
       FROM topic_ideas
       WHERE id = $1::int`,
      [input.topicIdeaId]
    );
    const idea = ideaRes.rows[0];
    if (!idea) throw new TopicIdeaNotFoundError(input.topicIdeaId);

    // 先查（契约要求），唯一索引只作为并发兜底
    const existing = await client.query<ContentProjectRow>(
      `SELECT ${DETAIL_COLUMNS} FROM content_projects WHERE source_idea_id = $1::int LIMIT 1`,
      [input.topicIdeaId]
    );
    if (existing.rows[0]) return { created: false, row: existing.rows[0] };

    try {
      const res = await client.query<ContentProjectRow>(
        `INSERT INTO content_projects
           (title, source_idea_id, source_report_date, content_type, target_audience, status)
         VALUES ($1, $2::int, $3::date, $4, $5, '草稿')
         RETURNING ${DETAIL_COLUMNS}`,
        [idea.title, input.topicIdeaId, idea.report_date, input.contentType, input.targetAudience]
      );
      return { created: true, row: res.rows[0] };
    } catch (err) {
      // 并发下另一个请求先插入：23505 唯一冲突 → 返回既有行，不报错
      if (isUniqueViolation(err)) {
        const again = await client.query<ContentProjectRow>(
          `SELECT ${DETAIL_COLUMNS} FROM content_projects WHERE source_idea_id = $1::int LIMIT 1`,
          [input.topicIdeaId]
        );
        if (again.rows[0]) return { created: false, row: again.rows[0] };
      }
      throw err;
    }
  } finally {
    client.release();
  }
}

/** 局部更新策划字段；不存在返回 null。source_* 不在白名单内，永远写不进去 */
export async function updateContentProject(
  id: number,
  patch: ProjectPatchValues
): Promise<ContentProjectRow | null> {
  const fields = (Object.keys(patch) as (keyof ProjectPatchValues)[]).filter(
    (f) => f in PATCH_COLUMN
  );

  const client = await getWritePool().connect();
  try {
    if (fields.length === 0) {
      const res = await client.query<ContentProjectRow>(
        `SELECT ${DETAIL_COLUMNS} FROM content_projects WHERE id = $1::int`,
        [id]
      );
      return res.rows[0] ?? null;
    }

    const values: unknown[] = [];
    const sets = fields.map((f) => {
      const raw = patch[f];
      values.push(JSONB_FIELDS.has(f) ? JSON.stringify(raw) : raw);
      return `${PATCH_COLUMN[f]} = $${values.length}${JSONB_FIELDS.has(f) ? "::jsonb" : ""}`;
    });
    values.push(id);

    const res = await client.query<ContentProjectRow>(
      `UPDATE content_projects
       SET ${sets.join(", ")}, updated_at = NOW()
       WHERE id = $${values.length}::int
       RETURNING ${DETAIL_COLUMNS}`,
      values
    );
    return res.rows[0] ?? null;
  } finally {
    client.release();
  }
}

/**
 * 标记已导出：production_status='已导出待生产'、exported_at=NOW()、status='已导出'。
 * 若项目此前已进入回读阶段（production_status 更靠后），不倒退状态。
 */
export async function markContentProjectExported(
  id: number,
  exportPath: string = SUGGESTED_EXPORT_PATH
): Promise<ContentProjectRow | null> {
  const client = await getWritePool().connect();
  try {
    const res = await client.query<ContentProjectRow>(
      `UPDATE content_projects
       SET production_status = '已导出待生产',
           exported_at = NOW(),
           export_path = $2,
           status = '已导出',
           updated_at = NOW()
       WHERE id = $1::int
         AND production_status = '未导出'
       RETURNING ${DETAIL_COLUMNS}`,
      [id, exportPath]
    );
    if (res.rows[0]) return res.rows[0];

    // 已导出过：只刷新导出时间与路径，不覆盖已回传的生产状态与项目阶段
    const again = await client.query<ContentProjectRow>(
      `UPDATE content_projects
       SET exported_at = NOW(), export_path = $2, updated_at = NOW()
       WHERE id = $1::int
       RETURNING ${DETAIL_COLUMNS}`,
      [id, exportPath]
    );
    return again.rows[0] ?? null;
  } finally {
    client.release();
  }
}

export interface ImportPatch {
  script_result?: unknown;
  storyboard_result?: unknown;
  quality_check?: unknown;
}

/**
 * 回读用户生产系统的产物。
 * - 只写确实提供的 JSONB 列，不用 null 覆盖历史结果；
 * - production_status 按「显式值 → 推导值」决定；
 * - 项目阶段：推完为「已完成」则 status='已完成'，否则 '已回传'。
 */
export async function importContentProjectResults(
  id: number,
  value: ImportValues,
  currentProductionStatus: ProductionStatus
): Promise<ContentProjectRow | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 0;

  const push = (column: string, v: unknown, cast = "") => {
    idx += 1;
    values.push(v);
    sets.push(`${column} = $${idx}${cast}`);
  };

  if (value.scriptResult !== undefined) push("script_result", JSON.stringify(value.scriptResult), "::jsonb");
  if (value.storyboardResult !== undefined)
    push("storyboard_result", JSON.stringify(value.storyboardResult), "::jsonb");
  if (value.qualityCheck !== undefined) push("quality_check", JSON.stringify(value.qualityCheck), "::jsonb");

  const nextProduction = resolveImportStatus(value, currentProductionStatus);
  const nextStatus: ProjectStatus = projectStatusForImport(nextProduction);
  push("production_status", nextProduction);
  push("status", nextStatus);

  idx += 1;
  values.push(id);

  const client = await getWritePool().connect();
  try {
    const res = await client.query<ContentProjectRow>(
      `UPDATE content_projects
       SET ${sets.join(", ")}, updated_at = NOW()
       WHERE id = $${idx}::int
       RETURNING ${DETAIL_COLUMNS}`,
      values
    );
    return res.rows[0] ?? null;
  } finally {
    client.release();
  }
}

/** 读当前 production_status（回读前取基线，不存在返回 null） */
export async function getProductionStatus(id: number): Promise<ProductionStatus | null> {
  const client = await getWritePool().connect();
  try {
    const res = await client.query<{ production_status: ProductionStatus }>(
      `SELECT production_status FROM content_projects WHERE id = $1::int`,
      [id]
    );
    return res.rows[0]?.production_status ?? null;
  } finally {
    client.release();
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "23505"
  );
}
