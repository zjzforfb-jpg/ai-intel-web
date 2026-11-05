// 运行状态记录 —— Owner: Agent B（主 Agent 提供 v0 最小实现，Agent B 补全）
// 全部 SQL 参数化；写入走 ai_intel_monitor 账号；不存报告正文
import { getMonitorPool } from "./db";
import type { CheckRun, CheckRunRow, CheckStatus, NotifyResult } from "./types";

export async function saveCheckRun(run: CheckRun): Promise<CheckRunRow> {
  const client = await getMonitorPool().connect();
  try {
    const { rows } = await client.query(
      `INSERT INTO monitor_runs (check_type, target_date, status, summary, issues)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       RETURNING *`,
      [run.checkType, run.targetDate, run.status, run.summary, JSON.stringify(run.issues)]
    );
    return rows[0] as CheckRunRow;
  } finally {
    client.release();
  }
}

export async function listCheckRuns(opts?: {
  status?: CheckStatus;
  limit?: number;
  offset?: number;
}): Promise<{ items: CheckRunRow[]; total: number }> {
  const limit = Math.min(Math.max(opts?.limit ?? 20, 1), 100);
  const offset = Math.max(opts?.offset ?? 0, 0);
  const where = opts?.status ? "WHERE status = $3" : "";
  const params: unknown[] = [limit, offset];
  if (opts?.status) params.push(opts.status);
  const client = await getMonitorPool().connect();
  try {
    const totalRes = await client.query(
      `SELECT count(*)::int AS n FROM monitor_runs ${opts?.status ? "WHERE status = $1" : ""}`,
      opts?.status ? [opts.status] : []
    );
    const { rows } = await client.query(
      `SELECT * FROM monitor_runs ${where} ORDER BY checked_at DESC LIMIT $1 OFFSET $2`,
      params
    );
    return { items: rows as CheckRunRow[], total: totalRes.rows[0].n as number };
  } finally {
    client.release();
  }
}

export async function getLatestCheckRun(): Promise<CheckRunRow | null> {
  const client = await getMonitorPool().connect();
  try {
    const { rows } = await client.query(
      `SELECT * FROM monitor_runs ORDER BY checked_at DESC LIMIT 1`
    );
    return (rows[0] as CheckRunRow) ?? null;
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
}> {
  const client = await getMonitorPool().connect();
  try {
    const last = await client.query(
      `SELECT checked_at, status FROM monitor_runs ORDER BY checked_at DESC LIMIT 1`
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
              count(*) FILTER (WHERE status = 'error')::int AS errors
       FROM monitor_runs WHERE checked_at > NOW() - interval '7 days'`
    );
    return {
      lastCheckAt: last.rows[0]?.checked_at ?? null,
      lastCheckStatus: (last.rows[0]?.status as CheckStatus) ?? null,
      latestReportDate: report.rows[0]?.d ?? null,
      issueCount24h: issues.rows[0].n as number,
      checks7d: week.rows[0].total as number,
      errors7d: week.rows[0].errors as number,
    };
  } finally {
    client.release();
  }
}

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
       ON CONFLICT (dedup_key) DO NOTHING`,
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
