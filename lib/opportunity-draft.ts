// 商业机会自动草稿 —— 从日报中提取的候选商机批量落库（AI 自动化入口）
// 与 lib/opportunities.ts（人工 CRUD）的分工：
// - 本模块面向 n8n/自动化批量写入：逐条校验、逐条去重，坏数据跳过不抛错，保证一批内尽量多落库；
// - status 固定「待研究」，notes 承载判断依据 + 来源日报日期（格式见 formatDraftNotes）。
//
// 阶段 2 改造（契约 docs/phase2-stageB-interface.md 第 3.5 节）：
// - 去重从「标题精确匹配」升级为「语义去重」（lib/dedup.ts 的 isDuplicate）；
// - 判定重复时**不丢弃新数据**：若新候选描述更完整，合并更新历史记录；
// - **绝不覆盖人工字段**：notes（人工改过）、action_plan、status 一律不动；
// - 跳过原因写明判定依据（命中实体/关键词/主题，或归一化标题相同）。
//
// 红线：读走 reader（lib/db.ts），写走 writer（lib/db-write.ts）；全部参数化 SQL；严禁 DDL。
import { getReadPool } from "./db";
import { getWritePool } from "./db-write";
import { isDuplicate, type DedupResult } from "./dedup";
import { normalizeTitle } from "./normalize";

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
  /** 命中的历史记录 id（语义去重命中时非 -1） */
  matchedId?: number;
  /** 命中的历史标题 */
  matchedTitle?: string;
  /** 判定得分 0~1 */
  score?: number;
}

export interface DraftResult {
  inserted: number;
  skipped: DraftSkipReason[];
  /** 因重复而被合并到历史记录上的候选数（描述更完整，合并而非丢弃） */
  merged: number;
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
 * 标题归一化：委托 lib/normalize.ts 的 normalizeTitle。
 * 阶段 2 起语义去重取代了旧的「trim 精确匹配」，
 * 归一化规则（全半角 / 大小写 / 营销词 / 实体变体）与去重器保持一致。
 */
export function normalizeDraftTitle(title: string): string {
  return normalizeTitle(title);
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

/** 全表历史条目（供语义去重比对） */
interface ExistingOpportunity {
  id: number;
  title: string;
  description: string | null;
  category: string | null;
  status: string;
  notes: string | null;
  action_plan: string | null;
}

/** 合并时判定「新描述是否比旧描述更完整」：长度优先，其次信息密度（关键词数） */
function isRicherDescription(next: string, current: string | null): boolean {
  const cur = (current ?? "").trim();
  if (!cur) return true;
  if (next.trim().length > cur.length) return true;
  if (next.trim().length < cur.length) return false;
  // 长度相同则比较非空字符数量（中英文标点也算信息）
  const density = (s: string) => s.replace(/\s+/g, "").length;
  return density(next) > density(cur);
}

/**
 * 批量落库候选商机（阶段 2 语义去重版）：
 * 1. 逐条校验（title/description 必填限长、category 限长），不合格跳过并记原因；
 * 2. 同批内按归一化标题去重（后出现的跳过）；
 * 3. 与**全表**历史记录做**语义去重**（lib/dedup.ts 的 isDuplicate）；
 * 4. 判定重复时：
 *    - 若新候选的 description 更完整 → 合并更新历史记录的 description（不丢数据）；
 *    - 绝不覆盖人工字段（notes / action_plan / status）；
 *    - 跳过原因写明判定依据；
 * 5. 写入 status='待研究'、source_report_date=reportDate、notes=判断依据+来源日报。
 *
 * reportDate 必须是 YYYY-MM-DD，非法直接抛错（整批作废——来源日期错误的数据没有价值）。
 * 候选列表为空时返回 { inserted: 0, skipped: [], merged: 0 }，不视为错误。
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

  // 1) 逐条校验 + 同批内归一化标题去重
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
      skipped.push({ title: v.title, reason: "同批候选中标题重复（归一化后一致）" });
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
    return { inserted: 0, skipped, merged: 0 };
  }

  // 2) 读全表历史（不分日期），供语义去重比对
  const readClient = await getReadPool().connect();
  let existing: ExistingOpportunity[];
  try {
    const res = await readClient.query<ExistingOpportunity>(
      `SELECT id::int AS id, title, description, category, status, notes, action_plan
       FROM opportunities
       ORDER BY id ASC`
    );
    existing = res.rows;
  } finally {
    readClient.release();
  }

  // 3) 逐条语义去重（历史集合动态增长，批内重复也能识别）
  const writeClient = await getWritePool().connect();
  try {
    let inserted = 0;
    let merged = 0;
    // 已插入的候选也加入历史池，供后续候选比对
    const historyPool: Array<{ id: number; title: string; description: string | null }> = existing.map((e) => ({
      id: e.id,
      title: e.title,
      description: e.description,
    }));

    for (const v of valid) {
      const result: DedupResult = isDuplicate(
        { title: v.title, description: v.description },
        historyPool
      );

      if (result.duplicate && result.match) {
        const matched = historyPool.find((h) => h.title === result.match?.title);
        const matchedId = matched?.id ?? result.match.id ?? -1;

        // 命中同一条历史记录：合并更完整的描述。
        // 只更新 description 列——notes / action_plan / status 一律不碰，
        // 因此人工编辑过的备注、推进过的状态都不会被覆盖。
        if (matched && matchedId > 0 && isRicherDescription(v.description, matched.description)) {
          const upd = await writeClient.query(
            `UPDATE opportunities
             SET description = $1, updated_at = NOW()
             WHERE id = $2::int AND status <> '已放弃'`,
            [v.description, matchedId]
          );
          if ((upd.rowCount ?? 0) > 0) {
            matched.description = v.description;
            merged += 1;
          }
        }

        skipped.push({
          title: v.title,
          reason: `语义重复：${result.match.reason}`,
          matchedId,
          matchedTitle: result.match.title,
          score: result.score,
        });
        continue;
      }

      // 4) 写入：writer 账号；INSERT 自带 NOT EXISTS 防并发重复（与 n8n SQL 语义一致）
      const res = await writeClient.query<{ id: number }>(
        `INSERT INTO opportunities (title, description, category, source_report_date, status, notes)
         SELECT $1, $2, $3, $4::date, '待研究', $5
         WHERE NOT EXISTS (SELECT 1 FROM opportunities WHERE trim(title) = trim($1))
         RETURNING id::int AS id`,
        [v.title, v.description, v.category, reportDate, formatDraftNotes(reportDate, v.rationale)]
      );
      inserted += res.rowCount ?? 0;

      // 插入成功后加入历史池，后续候选可比对
      const newId = res.rows[0]?.id ?? -1;
      historyPool.push({ id: newId, title: v.title, description: v.description });
    }
    return { inserted, skipped, merged };
  } finally {
    writeClient.release();
  }
}
