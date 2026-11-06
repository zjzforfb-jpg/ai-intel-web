// 商业机会自动草稿 —— 从日报中提取的候选商机批量落库（AI 自动化入口）
// 与 lib/opportunities.ts（人工 CRUD）的分工：
// - 本模块面向 n8n/自动化批量写入：逐条校验、逐条去重，坏数据跳过不抛错，保证一批内尽量多落库；
// - status 固定「待研究」，notes 承载判断依据 + 来源日报日期（格式见 formatDraftNotes）。
// 红线：读走 reader（lib/db.ts），写走 writer（lib/db-write.ts）；全部参数化 SQL；严禁 DDL。
import { getReadPool } from "./db";
import { getWritePool } from "./db-write";

/** 单条候选商机（来自 LLM 对日报的分析输出） */
export interface OpportunityCandidate {
  title: string;
  description: string;
  /** 分类：自由文本（opportunities.category 无枚举约束），空则落 NULL */
  category?: string | null;
  /** 判断依据：必须引用日报中的具体事实，写入 notes */
  rationale?: string | null;
}

export interface DraftSkipReason {
  title: string;
  reason: string;
}

export interface DraftResult {
  inserted: number;
  skipped: DraftSkipReason[];
}

/* ==================== 限制（与 opportunities-shared 的 validateOpportunity 保持一致） ==================== */

const MAX_TITLE = 200;
const MAX_CATEGORY = 100;
const MAX_TEXT = 20000;

/* ==================== notes 格式约定 ==================== */

/**
 * 自动草稿写入 notes 的格式（页面据此识别展示）：
 * - 有判断依据：`判断依据：{rationale}（来源日报 {reportDate}）`
 * - 无判断依据：`来源日报 {reportDate}`
 */
export const DRAFT_NOTES_PREFIX = "判断依据：";

/** 拼接自动草稿的 notes 内容 */
export function formatDraftNotes(reportDate: string, rationale?: string | null): string {
  const r = (rationale ?? "").trim();
  return r ? `${DRAFT_NOTES_PREFIX}${r}（来源日报 ${reportDate}）` : `来源日报 ${reportDate}`;
}

/** 判断 notes 是否为自动草稿格式（供页面展示区分「判断依据」与普通备注） */
export function isDraftNotes(notes: string | null | undefined): boolean {
  if (!notes) return false;
  return notes.startsWith(DRAFT_NOTES_PREFIX) || /^来源日报 \d{4}-\d{2}-\d{2}$/.test(notes.trim());
}

/* ==================== 去重与校验 ==================== */

/**
 * 标题归一化：仅 trim 后精确匹配（大小写敏感）。
 * 取舍说明：商机标题以中文为主，大小写变体场景极少；且 n8n PostgreSQL 节点
 * 采用同样的 `trim(title) = trim($1)` 语义（见 docs/phase1-opps-n8n.md），
 * 两边保持一致比单边更稳妥，故不做 lower() 归一化。
 */
export function normalizeDraftTitle(title: string): string {
  return title.trim();
}

function isValidDateString(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** 校验单条候选，返回错误原因；通过则返回归一化后的值 */
function validateCandidate(
  c: OpportunityCandidate
): { ok: true; title: string; description: string; category: string | null } | { ok: false; reason: string } {
  if (typeof c.title !== "string" || !c.title.trim()) {
    return { ok: false, reason: "标题缺失或为空" };
  }
  const title = c.title.trim();
  if (title.length > MAX_TITLE) {
    return { ok: false, reason: `标题超过 ${MAX_TITLE} 字` };
  }
  if (typeof c.description !== "string" || !c.description.trim()) {
    return { ok: false, reason: "描述缺失或为空" };
  }
  const description = c.description.trim();
  if (description.length > MAX_TEXT) {
    return { ok: false, reason: `描述超过 ${MAX_TEXT} 字` };
  }
  let category: string | null = null;
  if (c.category != null && typeof c.category === "string" && c.category.trim()) {
    if (c.category.trim().length > MAX_CATEGORY) {
      return { ok: false, reason: `分类超过 ${MAX_CATEGORY} 字` };
    }
    category = c.category.trim();
  }
  if (c.rationale != null && typeof c.rationale === "string" && c.rationale.trim().length > MAX_TEXT) {
    return { ok: false, reason: `判断依据超过 ${MAX_TEXT} 字` };
  }
  return { ok: true, title, description, category };
}

/* ==================== 主流程 ==================== */

/**
 * 批量落库候选商机：
 * 1. 逐条校验（title/description 必填限长、category 限长），不合格跳过并记原因；
 * 2. 同批内按归一化标题去重（后出现的跳过）；
 * 3. 与全表既有记录按 trim(title) 精确匹配去重（不分日期，已有同名即跳过）；
 * 4. 写入 status='待研究'、source_report_date=reportDate、notes=判断依据+来源日报。
 *
 * reportDate 必须是 YYYY-MM-DD，非法直接抛错（整批作废——来源日期错误的数据没有价值）。
 * 候选列表为空时返回 { inserted: 0, skipped: [] }，不视为错误。
 */
export async function draftOpportunities(
  reportDate: string,
  candidates: OpportunityCandidate[]
): Promise<DraftResult> {
  if (!isValidDateString(reportDate)) {
    throw new Error(`reportDate 必须是合法的 YYYY-MM-DD 日期，收到：${reportDate}`);
  }
  if (!Array.isArray(candidates)) {
    throw new Error("candidates 必须是数组");
  }

  const skipped: DraftSkipReason[] = [];

  // 1) 逐条校验 + 同批内去重
  const valid: Array<{ title: string; description: string; category: string | null; rationale: string | null }> = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    const v = validateCandidate(c);
    if (!v.ok) {
      skipped.push({ title: typeof c.title === "string" ? c.title.trim() : "", reason: v.reason });
      continue;
    }
    const key = normalizeDraftTitle(v.title);
    if (seen.has(key)) {
      skipped.push({ title: v.title, reason: "同批候选中标题重复" });
      continue;
    }
    seen.add(key);
    valid.push({
      title: v.title,
      description: v.description,
      category: v.category,
      rationale: typeof c.rationale === "string" ? c.rationale.trim() : null,
    });
  }

  if (valid.length === 0) {
    return { inserted: 0, skipped };
  }

  // 2) 全表查重：reader 只读查询（不分日期，trim(title) 精确匹配）
  const titles = valid.map((v) => v.title);
  const readClient = await getReadPool().connect();
  let existingTitles: Set<string>;
  try {
    const res = await readClient.query<{ t: string }>(
      `SELECT DISTINCT trim(title) AS t FROM opportunities WHERE trim(title) = ANY($1::text[])`,
      [titles]
    );
    existingTitles = new Set(res.rows.map((r) => r.t));
  } finally {
    readClient.release();
  }

  // 3) 写入：writer 账号；INSERT 自带 NOT EXISTS 防并发重复（与 n8n SQL 语义一致）
  const writeClient = await getWritePool().connect();
  try {
    let inserted = 0;
    for (const v of valid) {
      if (existingTitles.has(normalizeDraftTitle(v.title))) {
        skipped.push({ title: v.title, reason: "已存在同名机会（按标题全表去重）" });
        continue;
      }
      const res = await writeClient.query(
        `INSERT INTO opportunities (title, description, category, source_report_date, status, notes)
         SELECT $1, $2, $3, $4::date, '待研究', $5
         WHERE NOT EXISTS (SELECT 1 FROM opportunities WHERE trim(title) = trim($1))`,
        [v.title, v.description, v.category, reportDate, formatDraftNotes(reportDate, v.rationale)]
      );
      inserted += res.rowCount ?? 0;
    }
    return { inserted, skipped };
  } finally {
    writeClient.release();
  }
}
