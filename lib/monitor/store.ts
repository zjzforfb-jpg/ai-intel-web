// 运行状态记录 —— Owner: Agent B
// 全部 SQL 参数化；写入走 ai_intel_monitor 账号；不存报告正文
// 约定：既有导出签名只增不改；列投影统一别名/转 text，保证运行时形状与 types.ts 契约一致
import { getMonitorPool } from "./db";
import type { CheckRun, CheckRunRow, CheckStatus, NotifyResult, NotifyStatus } from "./types";

/** monitor_notifications 表行（与表结构一致的 snake_case） */
export interface NotificationRow {
  id: number;
  run_id: number;
  dedup_key: string;
  channel: string;
  status: NotifyStatus;
  /** 脱敏原因/备注（恢复事件用它记录状态跃迁来源），不含密钥 */
  error: string | null;
  created_at: string;
}

/** 最近异常摘要（供总览展示，不含 issues 明细与报告正文） */
export interface AbnormalRunSummary {
  id: number;
  checkType: string;
  targetDate: string | null;
  status: CheckStatus;
  summary: string;
  checkedAt: string;
}

// 列投影：DATE/TIMESTAMPTZ 转 text 并按契约别名（pg 默认会把它们解析成 Date 对象）
const RUN_COLUMNS = `id, check_type AS "checkType", target_date::text AS "targetDate",
       status, summary, issues, checked_at::text AS "checked_at", created_at::text AS "created_at"`;

const NOTIFY_COLUMNS = `id, run_id, dedup_key, channel, status, error, created_at::text AS created_at`;

export async function saveCheckRun(run: CheckRun): Promise<CheckRunRow> {
  const client = await getMonitorPool().connect();
  try {
    const { rows } = await client.query(
      `INSERT INTO monitor_runs (check_type, target_date, status, summary, issues)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       RETURNING ${RUN_COLUMNS}`,
      [run.checkType, run.targetDate, run.status, run.summary, JSON.stringify(run.issues)]
    );
    return rows[0] as CheckRunRow;
  } finally {
    client.release();
  }
}

/**
 * 运行记录列表（checked_at DESC）。
 * 可选过滤：status / checkType / target_date 日期范围（fromDate、toDate 均含当天，YYYY-MM-DD）。
 */
export async function listCheckRuns(opts?: {
  status?: CheckStatus;
  checkType?: string;
  fromDate?: string;
  toDate?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: CheckRunRow[]; total: number }> {
  const limit = Math.min(Math.max(opts?.limit ?? 20, 1), 100);
  const offset = Math.max(opts?.offset ?? 0, 0);
  const conds: string[] = [];
  const params: unknown[] = [];
  if (opts?.status) {
    params.push(opts.status);
    conds.push(`status = $${params.length}`);
  }
  if (opts?.checkType) {
    params.push(opts.checkType);
    conds.push(`check_type = $${params.length}`);
  }
  if (opts?.fromDate) {
    params.push(opts.fromDate);
    conds.push(`target_date >= $${params.length}::date`);
  }
  if (opts?.toDate) {
    params.push(opts.toDate);
    conds.push(`target_date <= $${params.length}::date`);
  }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const client = await getMonitorPool().connect();
  try {
    const totalRes = await client.query(
      `SELECT count(*)::int AS n FROM monitor_runs ${where}`,
      params
    );
    const { rows } = await client.query(
      `SELECT ${RUN_COLUMNS} FROM monitor_runs ${where}
       ORDER BY checked_at DESC, id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );
    return { items: rows as CheckRunRow[], total: totalRes.rows[0].n as number };
  } finally {
    client.release();
  }
}

/** 按 id 取单条运行记录（详情页用） */
export async function getRunById(id: number): Promise<CheckRunRow | null> {
  const client = await getMonitorPool().connect();
  try {
    const { rows } = await client.query(
      `SELECT ${RUN_COLUMNS} FROM monitor_runs WHERE id = $1`,
      [id]
    );
    return (rows[0] as CheckRunRow) ?? null;
  } finally {
    client.release();
  }
}

/** 某次运行关联的全部通知/恢复记录（详情页用，按时间升序） */
export async function listNotifications(runId: number): Promise<NotificationRow[]> {
  const client = await getMonitorPool().connect();
  try {
    const { rows } = await client.query(
      `SELECT ${NOTIFY_COLUMNS} FROM monitor_notifications WHERE run_id = $1
       ORDER BY created_at ASC, id ASC`,
      [runId]
    );
    return rows as NotificationRow[];
  } finally {
    client.release();
  }
}

export async function getMonitorOverview(): Promise<{
  lastCheckAt: string | null;
  lastCheckStatus: CheckStatus | null;
  latestReportDate: string | null;
  issueCount24h: number;
  checks7d: number;
  errors7d: number;
  /** 最近一次 ok 检查的时间 */
  lastOkAt: string | null;
  /** 近 7 天各状态计数 */
  statusCounts7d: { ok: number; warn: number; error: number };
  /** 最近 5 条异常摘要（status <> ok，按时间倒序） */
  recentIssues: AbnormalRunSummary[];
}> {
  const client = await getMonitorPool().connect();
  try {
    const last = await client.query(
      `SELECT checked_at::text AS checked_at, status FROM monitor_runs
       ORDER BY checked_at DESC, id DESC LIMIT 1`
    );
    const lastOk = await client.query(
      `SELECT max(checked_at)::text AS t FROM monitor_runs WHERE status = 'ok'`
    );
    const report = await client.query(
      `SELECT max(report_date)::text AS d FROM daily_reports`
    );
    const issues = await client.query(
      `SELECT count(*)::int AS n FROM monitor_runs
       WHERE checked_at > NOW() - interval '24 hours' AND status <> 'ok'`
    );
    const week = await client.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status = 'ok')::int AS ok,
              count(*) FILTER (WHERE status = 'warn')::int AS warn,
              count(*) FILTER (WHERE status = 'error')::int AS error
       FROM monitor_runs WHERE checked_at > NOW() - interval '7 days'`
    );
    const recent = await client.query(
      `SELECT id, check_type AS "checkType", target_date::text AS "targetDate",
              status, summary, checked_at::text AS "checkedAt"
       FROM monitor_runs WHERE status <> 'ok'
       ORDER BY checked_at DESC, id DESC LIMIT 5`
    );
    return {
      lastCheckAt: (last.rows[0]?.checked_at as string) ?? null,
      lastCheckStatus: (last.rows[0]?.status as CheckStatus) ?? null,
      latestReportDate: (report.rows[0]?.d as string) ?? null,
      issueCount24h: issues.rows[0].n as number,
      checks7d: week.rows[0].total as number,
      errors7d: week.rows[0].error as number,
      lastOkAt: (lastOk.rows[0]?.t as string) ?? null,
      statusCounts7d: {
        ok: week.rows[0].ok as number,
        warn: week.rows[0].warn as number,
        error: week.rows[0].error as number,
      },
      recentIssues: recent.rows as AbnormalRunSummary[],
    };
  } finally {
    client.release();
  }
}

/**
 * 通知日志写入（upsert 语义）：
 * 同 dedup_key 不产生重复行；冲突时仅当旧状态非 sent 才更新 status/error——
 * failed/skipped 占位后允许被后续 sent 补记，而 sent 是终态、不被 failed/skipped 降级，
 * 保证 isNotified（只认 sent）与实际送达状态一致、不反复重试。
 */
export async function saveNotificationLog(
  runId: number,
  dedupKey: string,
  result: NotifyResult
): Promise<void> {
  const client = await getMonitorPool().connect();
  try {
    await client.query(
      `INSERT INTO monitor_notifications (run_id, dedup_key, status, error)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (dedup_key) DO UPDATE SET
         status = EXCLUDED.status,
         error = EXCLUDED.error
       WHERE monitor_notifications.status IS DISTINCT FROM 'sent'`,
      [runId, dedupKey, result.status, result.reason ?? null]
    );
  } finally {
    client.release();
  }
}

export async function isNotified(dedupKey: string): Promise<boolean> {
  const client = await getMonitorPool().connect();
  try {
    const { rows } = await client.query(
      `SELECT 1 FROM monitor_notifications WHERE dedup_key = $1 AND status = 'sent' LIMIT 1`,
      [dedupKey]
    );
    return rows.length > 0;
  } finally {
    client.release();
  }
}

/**
 * 同一 (checkType, targetDate) 已记录的恢复事件条数（含 failed/skipped 与旧格式键）。
 * runner 用它推算下一次恢复的序号，生成 recovery:<checkType>:<targetDate>#<N> 去重键，
 * 使同日多次「异常→恢复」跃迁每次都有独立键、都能通知。
 */
export async function countRecoveryNotifications(
  checkType: string,
  targetDate: string
): Promise<number> {
  const prefix = `recovery:${checkType}:${targetDate}`;
  const client = await getMonitorPool().connect();
  try {
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM monitor_notifications
       WHERE dedup_key = $1 OR dedup_key LIKE $2`,
      [prefix, `${prefix}#%`]
    );
    return rows[0].n as number;
  } finally {
    client.release();
  }
}

/**
 * 恢复状态记录（设计意图）：
 * 表结构固定不新增列，「恢复」= 前次 warn/error 后本轮转为 ok 的状态跃迁，
 * 本质是一次需要留痕的通知事件，故复用 monitor_notifications 表表达——
 *   - dedup_key 以 "recovery:" 前缀与常规异常通知区分；runner 传入带恢复序号的键
 *     recovery:<checkType>:<targetDate>#<N>（N 由 countRecoveryNotifications 推算），
 *     保证同日多次恢复各自独立成键、互不被 ON CONFLICT 丢弃；
 *     缺省键（不带序号的旧格式 recovery:<checkType>:<targetDate>）仅为兼容保留；
 *   - channel 默认 'recovery'；
 *   - status 记录恢复通知的送达结果（sent/failed/skipped）；
 *   - error 列泛化为「原因/备注」，此处记录跃迁来源（如上次 error）。
 * 调用方（runner）只在真实状态跃迁（上一次非 ok → 本轮 ok）时调用，避免无跃迁误记。
 */
export async function markRunNotified(
  runId: number,
  status: NotifyStatus,
  opts?: { dedupKey?: string; channel?: string; reason?: string }
): Promise<void> {
  let dedupKey = opts?.dedupKey;
  if (!dedupKey) {
    const run = await getRunById(runId);
    if (!run) throw new Error(`markRunNotified: monitor_runs 不存在 id=${runId}`);
    dedupKey = `recovery:${run.checkType}:${run.targetDate ?? "global"}`;
  }
  const client = await getMonitorPool().connect();
  try {
    await client.query(
      `INSERT INTO monitor_notifications (run_id, dedup_key, channel, status, error)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (dedup_key) DO NOTHING`,
      [runId, dedupKey, opts?.channel ?? "recovery", status, opts?.reason ?? null]
    );
  } finally {
    client.release();
  }
}
