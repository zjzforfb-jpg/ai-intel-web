// 内容生产 —— 读层（content_projects 只读查询）
//
// 红线：
// - 只走 getReadPool()（ai_intel_reader，仅 SELECT）；
// - 全部 SQL 参数化，动态列名只来自本文件常量；
// - 不修改 topic_ideas / daily_reports，只读取来源信息。
//
// 依据：docs/phase3-stageB-interface.md §2.3 / §5
import { getReadPool } from "./db";
import { getIdea } from "./ideas";
import type { IdeaRow } from "./ideas-shared";
import type {
  ContentProjectListItem,
  ContentProjectRow,
  ProjectStatus,
} from "./content-projects-shared";
import { isProjectStatus } from "./content-projects-shared";

/** 列表用列（不含三份可能很大的 JSONB 结果） */
const LIST_COLUMNS = `id::int AS id, title, source_idea_id::int AS source_idea_id,
  source_report_date::text AS source_report_date, content_type, target_audience, status,
  content_angle, hook, key_points, reference_materials, production_notes,
  duration_seconds, video_form, open_questions, production_status,
  exported_at::text AS exported_at, export_path,
  created_at::text AS created_at, updated_at::text AS updated_at`;

/** 详情用列（在列表列基础上追加回读结果） */
const DETAIL_COLUMNS = `${LIST_COLUMNS}, script_result, storyboard_result, quality_check`;

export interface ContentProjectListQuery {
  status?: ProjectStatus | string | null;
  page?: number;
  size?: number;
}

export interface ContentProjectListResult {
  items: ContentProjectListItem[];
  total: number;
  page: number;
  size: number;
}

const DEFAULT_SIZE = 20;
const MAX_SIZE = 100;

function normalizeQuery(q: ContentProjectListQuery): {
  status: ProjectStatus | null;
  page: number;
  size: number;
} {
  const status = isProjectStatus(q.status) ? q.status : null;
  const page = Number.isInteger(q.page) && (q.page as number) > 0 ? (q.page as number) : 1;
  const rawSize = Number.isInteger(q.size) && (q.size as number) > 0 ? (q.size as number) : DEFAULT_SIZE;
  return { status, page, size: Math.min(rawSize, MAX_SIZE) };
}

/** 列表：按状态筛选 + 分页，更新时间倒序 */
export async function listContentProjects(
  q: ContentProjectListQuery = {}
): Promise<ContentProjectListResult> {
  const { status, page, size } = normalizeQuery(q);
  const offset = (page - 1) * size;

  const client = await getReadPool().connect();
  try {
    const [countRes, listRes] = await Promise.all([
      client.query(
        `SELECT count(*)::int AS total
         FROM content_projects
         WHERE ($1::text IS NULL OR status = $1)`,
        [status]
      ),
      client.query<ContentProjectListItem>(
        `SELECT ${LIST_COLUMNS}
         FROM content_projects
         WHERE ($1::text IS NULL OR status = $1)
         ORDER BY updated_at DESC, id DESC
         LIMIT $2 OFFSET $3`,
        [status, size, offset]
      ),
    ]);
    return { items: listRes.rows, total: countRes.rows[0].total as number, page, size };
  } finally {
    client.release();
  }
}

/** 内容项目总数（页头统计，不受筛选影响） */
export async function countContentProjects(): Promise<number> {
  const client = await getReadPool().connect();
  try {
    const res = await client.query("SELECT count(*)::int AS total FROM content_projects");
    return res.rows[0].total as number;
  } finally {
    client.release();
  }
}

/** 各状态项目数（筛选项上显示真实数量，不虚构） */
export async function countContentProjectsByStatus(): Promise<Record<string, number>> {
  const client = await getReadPool().connect();
  try {
    const res = await client.query<{ status: string; n: number }>(
      `SELECT status, count(*)::int AS n FROM content_projects GROUP BY status`
    );
    const out: Record<string, number> = {};
    for (const row of res.rows) out[row.status] = row.n;
    return out;
  } finally {
    client.release();
  }
}

/** 详情：全字段；不存在返回 null */
export async function getContentProject(id: number): Promise<ContentProjectRow | null> {
  const client = await getReadPool().connect();
  try {
    const res = await client.query<ContentProjectRow>(
      `SELECT ${DETAIL_COLUMNS} FROM content_projects WHERE id = $1::int`,
      [id]
    );
    return res.rows[0] ?? null;
  } finally {
    client.release();
  }
}

/** 按来源选题查项目（用于重复创建检测；source_idea_id 非空时唯一） */
export async function getContentProjectByIdeaId(
  ideaId: number
): Promise<ContentProjectRow | null> {
  const client = await getReadPool().connect();
  try {
    const res = await client.query<ContentProjectRow>(
      `SELECT ${DETAIL_COLUMNS} FROM content_projects WHERE source_idea_id = $1::int LIMIT 1`,
      [ideaId]
    );
    return res.rows[0] ?? null;
  } finally {
    client.release();
  }
}

/** 来源选题原文（读取 topic_ideas，绝不改写） */
export async function getSourceIdea(ideaId: number | null): Promise<IdeaRow | null> {
  if (ideaId === null) return null;
  return getIdea(ideaId);
}

export interface SourceReportBrief {
  report_date: string;
  title: string;
}

/** 来源日报标题（软引用；不存在返回 null，不编造） */
export async function getSourceReportBrief(
  date: string | null
): Promise<SourceReportBrief | null> {
  if (!date) return null;
  const client = await getReadPool().connect();
  try {
    const res = await client.query<SourceReportBrief>(
      `SELECT report_date::text AS report_date, title
       FROM daily_reports
       WHERE report_date = $1::date`,
      [date]
    );
    return res.rows[0] ?? null;
  } finally {
    client.release();
  }
}
