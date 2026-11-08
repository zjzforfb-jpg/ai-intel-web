// 实体写入层 —— ai_intel_writer 账号，仅 entities / entity_mentions 两张表
//
// 契约：docs/phase3-stageB-interface.md 第 3.5 节
// 红线：
// - 全部 SQL 参数化，不拼接任何用户输入；
// - 实体 upsert 只刷新 updated_at，绝不覆盖 description / website（人工字段）；
// - mention 以 (entity_id, report_id) 为幂等键，一篇日报里一个实体只有一行，重复执行不新增行。
//
// 实现注意：
// 数据库上的唯一约束是 UNIQUE (entity_id, report_id)（migrations/006 + 010 的最终形态）。
// 早期版本这里写成三列 (entity_id, report_id, source_title)，与库约束不匹配，
// report_id 非空时必定抛 42P10（there is no unique or exclusion constraint matching
// the ON CONFLICT specification）。因为当时所有测试都传 reportId: null 走下面的 NULL 分支，
// 这个缺陷长期未被覆盖；现已由 tests/entities.test.ts 的「真实 report_id」用例守住。
//
// 分数语义与 n8n 侧保持一致：重跑同一篇日报时，source_title / source_url / context /
// importance_score 全部覆盖为最新一次，而不是取历史最大值。
// （n8n 侧：scripts/phase3-n8n-entities.mts 的 ON CONFLICT ... DO UPDATE SET 即此语义）
import { getReadPool } from "./db";
import { getWritePool } from "./db-write";
import {
  extractEntityMentions,
  type EntityType,
  type ExtractInput,
  type ExtractedMention,
} from "./entities-extract";

/** 实体 upsert 输入 */
export interface EntityUpsertInput {
  name: string;
  normalizedName: string;
  entityType: EntityType;
  /** 小写别名，落 entities.aliases */
  aliases: string[];
}

/** mention 写入输入 */
export interface MentionWriteRow {
  entityId: number;
  reportId: number | null;
  /** "YYYY-MM-DD" */
  reportDate: string;
  sourceTitle: string | null;
  sourceUrl: string | null;
  context: string | null;
  importanceScore: number;
}

export interface WriteMentionsResult {
  inserted: number;
  updated: number;
}

export interface WriteExtractionResult {
  /** 本次落库的实体数（归一化名去重后） */
  entities: number;
  /** 本次处理到的 mention 条数 */
  mentions: number;
  inserted: number;
  updated: number;
  /** 解析到的日报 id；日报未入库时为 null */
  reportId: number | null;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 5;
  return Math.min(10, Math.max(1, Math.round(value)));
}

/** 日报日期 → daily_reports.id；不存在返回 null（软引用，允许为空） */
export async function resolveReportId(reportDate: string): Promise<number | null> {
  if (!DATE_PATTERN.test(reportDate)) return null;
  const client = await getReadPool().connect();
  try {
    const res = await client.query<{ id: number }>(
      "SELECT id::int AS id FROM daily_reports WHERE report_date = $1::date",
      [reportDate]
    );
    return res.rows[0]?.id ?? null;
  } finally {
    client.release();
  }
}

/**
 * 实体 upsert（幂等）。
 * ON CONFLICT (normalized_name) 只刷新 updated_at，不覆盖人工维护的 description / website，
 * 也不覆盖首次写入的 aliases（契约 §3.5）。
 */
export async function upsertEntity(input: EntityUpsertInput): Promise<number> {
  const client = await getWritePool().connect();
  try {
    return await upsertEntityOn(client, input);
  } finally {
    client.release();
  }
}

type Queryable = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

async function upsertEntityOn(client: Queryable, input: EntityUpsertInput): Promise<number> {
  const res = await client.query(
    `INSERT INTO entities (name, normalized_name, entity_type, aliases)
     VALUES ($1, $2, $3, $4::text[])
     ON CONFLICT (normalized_name) DO UPDATE SET
       updated_at = NOW()
     RETURNING id::int AS id`,
    [input.name, input.normalizedName, input.entityType, input.aliases]
  );
  return Number(res.rows[0].id);
}

/** 单条 mention 的幂等写入 */
async function upsertMentionOn(
  client: Queryable,
  row: MentionWriteRow
): Promise<"inserted" | "updated"> {
  const score = clampScore(row.importanceScore);

  if (row.reportId !== null) {
    const res = await client.query(
      `INSERT INTO entity_mentions
         (entity_id, report_id, mention_date, source_title, source_url, context, importance_score)
       VALUES ($1, $2, $3::date, $4, $5, $6, $7)
       ON CONFLICT (entity_id, report_id) DO UPDATE SET
         source_title = EXCLUDED.source_title,
         source_url = EXCLUDED.source_url,
         context = EXCLUDED.context,
         importance_score = EXCLUDED.importance_score
       RETURNING (xmax = 0) AS inserted`,
      [
        row.entityId,
        row.reportId,
        row.reportDate,
        row.sourceTitle,
        row.sourceUrl,
        row.context,
        score,
      ]
    );
    return res.rows[0]?.inserted === true ? "inserted" : "updated";
  }

  // report_id 为 NULL（日报尚未入库）：UNIQUE 索引对 NULL 不去重（NULL 互不相等），
  // 因此用 mention_date 作为「哪一篇日报」的等价判据，保证 (实体, 日报) 仍只有一行。
  // 注意：这里不能用 source_title 当判据 —— 日报重跑时 LLM 会重写标题，
  // 按标题判重会在同一天插出第二行，导致 mentionCount / distinctMentionDays 被高估。
  const existed = await client.query(
    `SELECT id::int AS id FROM entity_mentions
     WHERE entity_id = $1
       AND report_id IS NULL
       AND mention_date = $2::date
     LIMIT 1`,
    [row.entityId, row.reportDate]
  );
  if (existed.rows.length > 0) {
    await client.query(
      `UPDATE entity_mentions
       SET source_title = $1,
           source_url = $2,
           context = $3,
           importance_score = $4
       WHERE id = $5::int`,
      [row.sourceTitle, row.sourceUrl, row.context, score, existed.rows[0].id]
    );
    return "updated";
  }
  await client.query(
    `INSERT INTO entity_mentions
       (entity_id, report_id, mention_date, source_title, source_url, context, importance_score)
     VALUES ($1, NULL, $2::date, $3, $4, $5, $6)`,
    [row.entityId, row.reportDate, row.sourceTitle, row.sourceUrl, row.context, score]
  );
  return "inserted";
}

/** 批量写入 mention（单事务，任一条失败整体回滚） */
export async function writeMentions(rows: MentionWriteRow[]): Promise<WriteMentionsResult> {
  const result: WriteMentionsResult = { inserted: 0, updated: 0 };
  if (rows.length === 0) return result;

  const client = await getWritePool().connect();
  try {
    await client.query("BEGIN");
    for (const row of rows) {
      const state = await upsertMentionOn(client, row);
      result[state] += 1;
    }
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** 把抽取结果按归一化名聚合成实体（别名取并集，类型取首次出现的类型） */
export function groupMentionsByEntity(
  mentions: ExtractedMention[]
): Array<EntityUpsertInput & { mentions: ExtractedMention[] }> {
  const byName = new Map<string, EntityUpsertInput & { mentions: ExtractedMention[] }>();
  for (const m of mentions) {
    const existed = byName.get(m.normalizedName);
    if (!existed) {
      byName.set(m.normalizedName, {
        name: m.canonical,
        normalizedName: m.normalizedName,
        entityType: m.entityType,
        aliases: [...m.aliases],
        mentions: [m],
      });
      continue;
    }
    for (const alias of m.aliases) {
      if (!existed.aliases.includes(alias)) existed.aliases.push(alias);
    }
    existed.mentions.push(m);
  }
  return Array.from(byName.values());
}

/**
 * 抽取 + 落库（推荐入口，n8n 侧复用的同一套逻辑）。
 * 幂等：同一日报重复执行，实体数不变、mention 数不变。
 */
export async function writeExtraction(
  input: ExtractInput & { reportId?: number | null }
): Promise<WriteExtractionResult> {
  if (!DATE_PATTERN.test(input.reportDate)) {
    throw new Error(`日报日期格式非法：${input.reportDate}（应为 YYYY-MM-DD）`);
  }

  const mentions = extractEntityMentions({
    reportDate: input.reportDate,
    reportMarkdown: input.reportMarkdown,
  });
  if (mentions.length === 0) {
    return { entities: 0, mentions: 0, inserted: 0, updated: 0, reportId: input.reportId ?? null };
  }

  const reportId =
    input.reportId === undefined ? await resolveReportId(input.reportDate) : input.reportId;
  const groups = groupMentionsByEntity(mentions);

  const client = await getWritePool().connect();
  try {
    await client.query("BEGIN");
    const rows: MentionWriteRow[] = [];
    for (const group of groups) {
      const entityId = await upsertEntityOn(client, {
        name: group.name,
        normalizedName: group.normalizedName,
        entityType: group.entityType,
        aliases: group.aliases,
      });
      for (const m of group.mentions) {
        rows.push({
          entityId,
          reportId,
          reportDate: m.reportDate,
          sourceTitle: m.sourceTitle,
          sourceUrl: m.sourceUrl,
          context: m.context,
          importanceScore: m.importanceScore,
        });
      }
    }

    let inserted = 0;
    let updated = 0;
    for (const row of rows) {
      const state = await upsertMentionOn(client, row);
      if (state === "inserted") inserted += 1;
      else updated += 1;
    }
    await client.query("COMMIT");
    return { entities: groups.length, mentions: mentions.length, inserted, updated, reportId };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * 安全版：抽取或写库失败只记录日志并返回空结果，绝不抛异常
 * （契约 §7：实体抽取失败不得中断日报写入主流程）。
 */
export async function writeExtractionSafe(
  input: ExtractInput & { reportId?: number | null }
): Promise<WriteExtractionResult> {
  try {
    return await writeExtraction(input);
  } catch (error) {
    console.error(
      `[entities-write] 实体抽取/写入失败（${input.reportDate}）：`,
      error instanceof Error ? error.message : error
    );
    return {
      entities: 0,
      mentions: 0,
      inserted: 0,
      updated: 0,
      reportId: input.reportId ?? null,
    };
  }
}
