// 监控数据库连接池 —— Owner: 主 Agent（共享热点，子 Agent 只读不改）
// ai_intel_monitor 账号：业务表只读 + monitor_* 两表 CRUD
import { Pool } from "pg";
import { DB_PORT } from "@/lib/config";

let pool: Pool | null = null;

export function getMonitorPool(): Pool {
  if (pool) return pool;

  const password = process.env.DB_MONITOR_PASSWORD;
  if (!password) {
    throw new Error("DB_MONITOR_PASSWORD is not set in environment");
  }

  pool = new Pool({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(DB_PORT),
    user: process.env.DB_MONITOR_USER || "ai_intel_monitor",
    password,
    database: process.env.DB_NAME || "ai_intelligence",
    max: 3,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    ssl: false,
  });

  // pg-pool：空闲连接出错若无人监听 'error' 事件会抛未捕获异常导致进程崩溃
  pool.on("error", (err) => {
    console.error("[monitor-db] 空闲连接异常:", err.message);
  });

  return pool;
}

/** report_failures 表行（n8n 采集失败兜底，snake_case 与表结构一致） */
export interface ReportFailureRow {
  id: number;
  report_date: string;
  stage: string;
  reason: string;
  raw_output: string | null;
  created_at: string;
}

/**
 * 查询目标日期的 n8n 采集失败兜底记录（report_failures，monitor 账号只读）。
 * 表尚未创建（undefined_table, 42P01）或未授权（permission denied, 42501）时返回 null，
 * 由调用方（runner 的 FAILURE_RECORD 规则）优雅跳过，不影响其余检查；其他错误向上抛出。
 */
export async function listReportFailures(
  targetDate: string
): Promise<ReportFailureRow[] | null> {
  const client = await getMonitorPool().connect();
  try {
    const { rows } = await client.query(
      `SELECT id, report_date::text AS report_date, stage, reason, raw_output,
              created_at::text AS created_at
       FROM report_failures
       WHERE report_date = $1::date
       ORDER BY id ASC`,
      [targetDate]
    );
    return rows as ReportFailureRow[];
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "42P01" || code === "42501") return null; // 表不存在/未授权 → 规则跳过
    throw e;
  } finally {
    client.release();
  }
}
