// 监控数据库连接池 —— Owner: 主 Agent（共享热点，子 Agent 只读不改）
// ai_intel_monitor 账号：业务表只读 + monitor_* 两表 CRUD
import { Pool } from "pg";

let pool: Pool | null = null;

export function getMonitorPool(): Pool {
  if (pool) return pool;

  const password = process.env.DB_MONITOR_PASSWORD;
  if (!password) {
    throw new Error("DB_MONITOR_PASSWORD is not set in environment");
  }

  pool = new Pool({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT) || 5433,
    user: process.env.DB_MONITOR_USER || "ai_intel_monitor",
    password,
    database: process.env.DB_NAME || "ai_intelligence",
    max: 3,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    ssl: false,
  });

  return pool;
}
